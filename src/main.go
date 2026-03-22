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
		// 2. 发现闯入！打印控制台日志
		log.Printf(" [⚠️ 自动存证] 司机 %s 闯入区域：%s", driverID, fenceName)

		// 3. 核心：将违规行为持久化到 alarm_logs 表
		alarmSQL := `
            INSERT INTO alarm_logs (driver_name, fence_name, location) 
            VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326))`

		_, insertErr := db.Exec(alarmSQL, driverID, fenceName, lng, lat)
		if insertErr != nil {
			log.Printf(" [❌ 存档失败] %v", insertErr)
		} else {
			log.Printf(" [✅ 存档成功] 违规记录已写入移动硬盘")
		}
	}
}

func UpdateHandle(w http.ResponseWriter, r *http.Request) {
	// 1. 解析参数
	id := r.URL.Query().Get("id")
	lngStr := r.URL.Query().Get("lng")
	latStr := r.URL.Query().Get("lat")

	if id == "" || lngStr == "" || latStr == "" {
		http.Error(w, "参数缺失", http.StatusBadRequest)
		return
	}

	lng, _ := strconv.ParseFloat(lngStr, 64)
	lat, _ := strconv.ParseFloat(latStr, 64)

	// 2. 同步操作：快速更新 Redis (内存操作)
	rdb.GeoAdd(ctx, "drivers:live", &redis.GeoLocation{
		Name: id, Longitude: lng, Latitude: lat,
	})

	// 3. 异步操作：启动协程处理耗时的磁盘写入和围栏检测
	// 注意：这里需要把外部变量传进去，防止闭包逃逸导致的数据问题
	go func(driverID string, longitude, latitude float64) {
		// 后台持久化到 PostGIS (磁盘操作)
		_, err := db.Exec(`INSERT INTO driver_history (name, location) VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326))`,
			driverID, longitude, latitude)

		if err != nil {
			log.Printf("数据库写入失败：%v", err)
			return
		}

		// 后台围栏检测
		checkFence(driverID, longitude, latitude)
	}(id, lng, lat)

	// 4. 立即响应客户端 (不再等待数据库写入结果)
	fmt.Fprintf(w, "OK: 司机 %s 坐标已接收并正在后台同步", id)
}

func NearbyHandle(w http.ResponseWriter, r *http.Request) {
	lng, _ := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	lat, _ := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)

	res, _ := rdb.GeoSearchLocation(ctx, "drivers:live", &redis.GeoSearchLocationQuery{
		GeoSearchQuery: redis.GeoSearchQuery{
			Longitude: lng, Latitude: lat, Radius: 5, RadiusUnit: "km", Sort: "ASC",
		},
		WithDist: true,
	}).Result()
	fmt.Fprintf(w, "附近结果： \n")
	for _, loc := range res {
		fmt.Fprintf(w, "- %s: %.2f km\n", loc.Name, loc.Dist)
	}
}

func HistoryHandle(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "缺少司机ID", http.StatusBadRequest)
		return
	}

	// 查询最近 100 条轨迹点，并转换为 GeoJSON 格式
	// 使用 ST_MakeLine 将散点聚合为一条线段（LineString）
	query := `
        SELECT ST_AsGeoJSON(ST_MakeLine(location ORDER BY created_at ASC)) 
        FROM (
            SELECT location, created_at FROM driver_history 
            WHERE name = $1 
            ORDER BY created_at DESC 
            LIMIT 100
        ) AS subquery`

	var geoJSON string
	err := db.QueryRow(query, id).Scan(&geoJSON)
	if err != nil {
		log.Printf("轨迹查询失败: %v", err)
		fmt.Fprintf(w, `{"type": "LineString", "coordinates": []}`) // 返回空轨迹
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*") // 允许前端跨域访问
	fmt.Fprint(w, geoJSON)
}

func AlarmsHandle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// 查询最近 10 条告警记录
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
	// 1. 优先从环境变量读取连接字符串，如果没有则使用默认值
	connStr := os.Getenv("DB_URL")
	if connStr == "" {
		// 这里的 172.17.0.1 是 Docker 访问宿主机的默认 IP
		connStr = "postgres://docker:floder123@172.17.0.1:5432/gis_db?sslmode=disable"
	}

	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "redis:6379"
	}

	// 2. 初始化 Redis
	rdb = redis.NewClient(&redis.Options{Addr: redisAddr})

	// 3. 初始化 Postgres
	var err error
	db, err = sql.Open("postgres", connStr)
	if err != nil {
		log.Fatal("数据库连接配置错误：", err)
	}

	// 检查数据库连接是否真正可用
	if err = db.Ping(); err != nil {
		log.Fatalf("无法连接到数据库 (%s)：%v", connStr, err)
	}

	http.HandleFunc("/update", UpdateHandle)
	http.HandleFunc("/nearby", NearbyHandle)
	http.HandleFunc("/history", HistoryHandle)
	http.HandleFunc("/alarms", AlarmsHandle)

	// 注意：静态文件路径要匹配 Dockerfile 里的工作目录
	http.Handle("/", http.FileServer(http.Dir("/root/static")))

	fmt.Println("[2026-03-20] 服务已启动，监听端口：8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
