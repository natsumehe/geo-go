package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

var (
	ctx = context.Background()
	rdb *redis.Client
	db  *sql.DB
)

// checkFence 负责检测并自动存档违规记录
func checkFence(driverID string, lng, lat float64) {
	var fenceName string
	// 空间碰撞检测：判定点是否在多边形内
	fenceQuery := `
                SELECT name FROM fences 
                WHERE ST_Contains(area, ST_SetSRID(ST_MakePoint($1, $2), 4326)) 
                LIMIT 1`

	err := db.QueryRow(fenceQuery, lng, lat).Scan(&fenceName)
	if err == nil {
		log.Printf(" [⚠️ 自动存证] 司机 %s 闯入区域：%s", driverID, fenceName)

		alarmSQL := `
            INSERT INTO alarm_logs (driver_name, fence_name, location) 
            VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326))`

		_, insertErr := db.Exec(alarmSQL, driverID, fenceName, lng, lat)
		if insertErr != nil {
			log.Printf(" [❌ 存档失败] %v", insertErr)
		} else {
			log.Printf(" [✅ 存档成功] 违规记录已写入数据库")
		}
	}
}

// UpdateHandle 处理手机端 GPS 上报
func UpdateHandle(w http.ResponseWriter, r *http.Request) {
	// 【关键】跨域支持，允许手机浏览器访问
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	id := r.URL.Query().Get("id")
	latStr := r.URL.Query().Get("lat")
	lngStr := r.URL.Query().Get("lng")
	if lngStr == "" {
		lngStr = r.URL.Query().Get("lon")
	}

	if id == "" || lngStr == "" || latStr == "" {
		http.Error(w, "Missing Parameters", http.StatusBadRequest)
		return
	}

	lng, _ := strconv.ParseFloat(lngStr, 64)
	lat, _ := strconv.ParseFloat(latStr, 64)

	// 1. 更新 Redis 实时位置
	if rdb != nil {
		rdb.GeoAdd(ctx, "drivers:live", &redis.GeoLocation{
			Name:      id,
			Longitude: lng,
			Latitude:  lat,
		})
	}

	// 2. 异步持久化与围栏检测
	go func(dID string, lo, la float64) {
		if db != nil {
			historySQL := `
                INSERT INTO driver_history (name, location) 
                VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326))`
			_, _ = db.Exec(historySQL, dID, lo, la)
			checkFence(dID, lo, la)
		}
	}(id, lng, lat)

	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "OK: %s Location Synced at %s", id, time.Now().Format("15:04:05"))
}

func HistoryHandle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "ID Required", http.StatusBadRequest)
		return
	}

	query := `
        SELECT COALESCE(ST_AsGeoJSON(ST_MakeLine(location ORDER BY created_at ASC)), '{"type": "LineString", "coordinates": []}') 
        FROM (
            SELECT location, created_at FROM driver_history 
            WHERE name = $1 
            ORDER BY created_at DESC 
            LIMIT 100
        ) AS subquery`

	var geoJSON string
	err := db.QueryRow(query, id).Scan(&geoJSON)
	if err != nil {
		geoJSON = `{"type": "LineString", "coordinates": []}`
	}
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, geoJSON)
}

func AlarmsHandle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	rows, err := db.Query(`
        SELECT driver_name, fence_name, to_char(created_at, 'HH24:MI:SS') 
        FROM alarm_logs 
        ORDER BY created_at DESC LIMIT 10`)
	if err != nil {
		fmt.Fprint(w, `[]`)
		return
	}
	defer rows.Close()

	var results []string
	for rows.Next() {
		var d, f, t string
		rows.Scan(&d, &f, &t)
		results = append(results, fmt.Sprintf(`{"driver":"%s", "fence":"%s", "time":"%s"}`, d, f, t))
	}
	fmt.Fprintf(w, "[%s]", strings.Join(results, ","))
}

func ListHandle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	rows, err := db.Query("SELECT DISTINCT name FROM driver_history WHERE created_at > NOW() - INTERVAL '24 hours'")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	devices := []string{}
	for rows.Next() {
		var n string
		rows.Scan(&n)
		devices = append(devices, n)
	}
	json.NewEncoder(w).Encode(devices)
}

func main() {
	// 1. 环境变量读取（数据库在宿主机 172.17.0.1）
	connStr := os.Getenv("DB_URL")
	if connStr == "" {
		connStr = "postgres://docker:floder123@172.17.0.1:5432/gis_db?sslmode=disable"
	}
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "redis:6379"
	}

	fmt.Printf("[DEBUG] 尝试连接数据库地址: %s\n", connStr)
	fmt.Printf("[DEBUG] 尝试连接 Redis 地址: %s\n", redisAddr)

	// 2. 初始化连接
	rdb = redis.NewClient(&redis.Options{Addr: redisAddr})

	var err error
	db, err = sql.Open("postgres", connStr)
	if err != nil {
		log.Fatalf("❌ 数据库驱动加载失败: %v", err)
	}

	// 检查数据库连通性（增加重试逻辑）
	for i := 0; i < 5; i++ {
		err = db.Ping()
		if err == nil {
			fmt.Println("✅ 数据库连接成功！")
			break
		}
		fmt.Printf("⚠️ 数据库连接尝试 (%d/5) 失败: %v，等待重试...\n", i+1, err)
		time.Sleep(2 * time.Second)
	}

	// 3. 路由与静态文件
	http.HandleFunc("/update", UpdateHandle)
	http.HandleFunc("/history", HistoryHandle)
	http.HandleFunc("/alarms", AlarmsHandle)
	http.HandleFunc("/list", ListHandle)

	// 自动适配容器与本地路径
	staticDir := "/app/static"
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		staticDir = "./static"
	}
	http.Handle("/", http.FileServer(http.Dir(staticDir)))

	// 4. 启动双协议服务
	go func() {
		fmt.Println("🔓 HTTP 备用服务启动: 8080")
		_ = http.ListenAndServe(":8080", nil)
	}()

	fmt.Println("🔒 HTTPS 安全服务准备启动: 443")
	// 这里的 server.crt/key 必须在运行目录下（/app/server.crt）
	err = http.ListenAndServeTLS(":443", "server.crt", "server.key", nil)
	if err != nil {
		log.Fatalf("❌ HTTPS 启动失败 (请检查证书是否在根目录): %v", err)
	}
}
