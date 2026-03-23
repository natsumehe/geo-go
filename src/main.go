package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

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
	// 1. 空间碰撞检测：判定点是否在多边形内
	fenceQuery := `
                SELECT name FROM fences 
                WHERE ST_Contains(area, ST_SetSRID(ST_MakePoint($1, $2), 4326)) 
                LIMIT 1`

	err := db.QueryRow(fenceQuery, lng, lat).Scan(&fenceName)

	if err == nil {
		log.Printf(" [⚠️ 自动存证] 司机 %s 闯入区域：%s", driverID, fenceName)

		// 2. 将违规行为持久化到 alarm_logs 表
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

func UpdateHandle(w http.ResponseWriter, r *http.Request) {
	// 【跨域支持】
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
		lngStr = r.URL.Query().Get("lon") // 自动兼容 Traccar/部分手机标准
	}

	if id == "" || lngStr == "" || latStr == "" {
		http.Error(w, "Missing Parameters", http.StatusBadRequest)
		return
	}

	lng, _ := strconv.ParseFloat(lngStr, 64)
	lat, _ := strconv.ParseFloat(latStr, 64)

	// 1. 更新 Redis 实时位置
	rdb.GeoAdd(ctx, "drivers:live", &redis.GeoLocation{
		Name:      id,
		Longitude: lng,
		Latitude:  lat,
	})

	// 2. 异步持久化与围栏检测
	go func(dID string, lo, la float64) {
		historySQL := `
            INSERT INTO driver_history (name, location) 
            VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326))`
		_, _ = db.Exec(historySQL, dID, lo, la)
		checkFence(dID, lo, la)
	}(id, lng, lat)

	fmt.Fprintf(w, "OK: %s Location Synced", id)
}

func HistoryHandle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "ID Required", http.StatusBadRequest)
		return
	}

	// 使用 COALESCE 防止 NULL 导致 Scan 报错
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

func main() {
	// 1. 获取环境参数
	connStr := os.Getenv("DB_URL")
	if connStr == "" {
		connStr = "postgres://docker:floder123@172.17.0.1:5432/gis_db?sslmode=disable"
	}
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "redis:6379"
	}

	// 2. 初始化连接
	rdb = redis.NewClient(&redis.Options{Addr: redisAddr})
	var err error
	db, err = sql.Open("postgres", connStr)
	if err != nil || db.Ping() != nil {
		log.Fatalf("数据库启动失败，请检查 DB_URL: %v", err)
	}

	// 3. 路由设置
	http.HandleFunc("/update", UpdateHandle)
	http.HandleFunc("/history", HistoryHandle)
	http.HandleFunc("/alarms", AlarmsHandle)

	// 注意：Docker 容器内的工作目录通常是 /app，确保静态文件路径匹配
	staticDir := "/app/static"
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		staticDir = "/root/static" // 备用路径
	}
	http.Handle("/", http.FileServer(http.Dir(staticDir)))

	// 4. 启动 HTTPS 服务
	port := ":443"
	fmt.Printf("[2026-03-23 18:50:45] 🔒 HTTPS 服务就绪，监听端口 %s\n", port)

	// 同时启动一个 HTTP 8080 端口作为备用（不加密）
	go func() {
		log.Println("🔓 HTTP 备用服务启动: 8080")
		_ = http.ListenAndServe(":8080", nil)
	}()

	// 启动主 HTTPS 服务
	err = http.ListenAndServeTLS(port, "src/server.crt", "src/server.key", nil)
	if err != nil {
		log.Fatalf("❌ HTTPS 启动失败 (检查证书文件是否存在): %v", err)
	}
}
