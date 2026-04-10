package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"geo-go/filters"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

var (
	ctx      = context.Background()
	rdb      *redis.Client
	db       *sql.DB
	posCache sync.Map
)

type LastPos struct {
	Lat       float64
	Lng       float64
	Timestamp time.Time
}

type LocationReport struct {
	DeviceID string  `json:"id"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Provider string  `json:"provider"` // 新增
	Accuracy float64 `json:"accuracy"` // 新增
}

type DeviceFilters struct {
	LatKF *filters.KalmanFilter
	LngKF *filters.KalmanFilter
}

var (
	// 内存存储：Key 是 DeviceID, Value 是 *DeviceFilters
	// 这种设计避免了频繁读写数据库，保证了算法响应的毫秒级
	kfStore = sync.Map{}
)

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
var clients = make(map[*websocket.Conn]bool) // 存储所有在线的管理端连接

func WsHandler(w http.ResponseWriter, r *http.Request) {
	conn, _ := upgrader.Upgrade(w, r, nil)
	clients[conn] = true // 记录连接
}

// 在 checkFence 发现违规时调用
func notifyClients(msg string) {
	for client := range clients {
		_ = client.WriteMessage(websocket.TextMessage, []byte(msg))
	}
}

// HaversineDistance 计算两点间的距离（单位：米）
func HaversineDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000 // 地球半径
	phi1 := lat1 * 3.14159 / 180
	phi2 := lat2 * 3.14159 / 180
	deltaPhi := (lat2 - lat1) * 3.14159 / 180
	deltaLambda := (lon2 - lon1) * 3.14159 / 180

	a := math.Sin(deltaPhi/2)*math.Sin(deltaPhi/2) +
		math.Cos(phi1)*math.Cos(phi2)*
			math.Sin(deltaLambda/2)*math.Sin(deltaLambda/2)
	return R * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

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
// UpdateHandle 处理手机端 GPS 上报 (已整合 sync.Map 过滤)
// UpdateHandle 处理手机端 GPS 上报 (全量留存 + 业务过滤双轨制)
func UpdateHandle(w http.ResponseWriter, r *http.Request) {
	// --- 1. 跨域与基础校验 --- (保持不变)
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// --- 2. 参数提取 ---
	id := r.URL.Query().Get("id")
	latStr := r.URL.Query().Get("lat")
	lngStr := r.URL.Query().Get("lng")
	if lngStr == "" {
		lngStr = r.URL.Query().Get("lon")
	}

	provider := r.URL.Query().Get("provider")
	if provider == "" {
		provider = "unknown"
	}

	accStr := r.URL.Query().Get("accuracy")
	accuracy, _ := strconv.ParseFloat(accStr, 64)
	if accuracy <= 0 {
		accuracy = 20.0
	} // 默认精度

	if id == "" || lngStr == "" || latStr == "" {
		http.Error(w, "Missing Parameters", http.StatusBadRequest)
		return
	}

	lng, _ := strconv.ParseFloat(lngStr, 64)
	lat, _ := strconv.ParseFloat(latStr, 64)

	// --- 3. 【核心增强】卡尔曼平滑计算 ---
	// 获取或创建滤波器
	valKF, _ := kfStore.LoadOrStore(id, &DeviceFilters{
		LatKF: &filters.KalmanFilter{LastValue: lat, P: 1.0, Q: 0.000001, R: 0.0001},
		LngKF: &filters.KalmanFilter{LastValue: lng, P: 1.0, Q: 0.000001, R: 0.0001},
	})
	kf := valKF.(*DeviceFilters)

	// 得到平滑后的坐标
	smoothLat := kf.LatKF.SmartUpdate(lat, accuracy)
	smoothLng := kf.LngKF.SmartUpdate(lng, accuracy)

	// --- 4. Redis 实时位置更新 (显示平滑后的点，视觉更顺滑) ---
	if rdb != nil {
		rdb.GeoAdd(ctx, "drivers:live", &redis.GeoLocation{
			Name: id, Longitude: smoothLng, Latitude: smoothLat,
		})
	}

	// --- 5. 业务逻辑过滤判定 ---
	// 使用平滑后的坐标进行距离计算，过滤效果更准确
	shouldWriteBusinessHistory := true
	valCache, ok := posCache.Load(id)
	if ok {
		last := valCache.(LastPos)
		dist := HaversineDistance(last.Lat, last.Lng, smoothLat, smoothLng)
		// 过滤：平滑后移动不足 3 米 且 时间不足 10s 则不记入历史
		if dist < 3.0 && time.Since(last.Timestamp) < 10*time.Second {
			shouldWriteBusinessHistory = false
		}
	}

	// --- 6. 异步双轨持久化 ---
	go func(dID string, rawLo, rawLa, smLo, smLa float64, prov string, acc float64, isMoving bool) {
		if db != nil {
			// A. 【原始表】存下最真实的、带噪声的数据（审计用）
			rawSQL := `INSERT INTO driver_raw_data (name, location, provider, accuracy, created_at)
                       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, NOW())`
			_, _ = db.Exec(rawSQL, dID, rawLo, rawLa, prov, acc)

			// B. 【设备状态】存下当前最新的平滑位置
			upsertSQL := `INSERT INTO devices (device_id, last_lat, last_lng, last_seen, last_provider)
                          VALUES ($1, $2, $3, NOW(), $4)
                          ON CONFLICT (device_id) DO UPDATE SET last_lat=$2, last_lng=$3, last_seen=NOW();`
			_, _ = db.Exec(upsertSQL, dID, smLa, smLo, prov)

			// C. 【业务历史】仅存储平滑后的轨迹点
			if isMoving {
				historySQL := `INSERT INTO driver_history (name, location, provider, accuracy, created_at) 
                               VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, NOW())`
				_, _ = db.Exec(historySQL, dID, smLo, smLa, prov, acc)

				// 更新缓存
				posCache.Store(dID, LastPos{Lat: smLa, Lng: smLo, Timestamp: time.Now()})

				// 触发围栏检测（使用平滑坐标减少误报）
				checkFence(dID, smLo, smLa)
			}
		}
	}(id, lng, lat, smoothLng, smoothLat, provider, accuracy, shouldWriteBusinessHistory)

	// --- 7. 响应客户端 ---
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "OK: %s Location Filtered & Synced", id)
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

// 后端 ListHandle 建议
func ListHandle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	// 从历史记录里提取所有不重复的设备名
	rows, err := db.Query("SELECT DISTINCT name FROM driver_history")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		if id != "" {
			ids = append(ids, id)
		}
	}
	json.NewEncoder(w).Encode(ids)
}

// UpdateLocationHandler 处理来自手机的 /update 请求
func UpdateLocationHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 1. 解析参数
		id := r.URL.Query().Get("id")
		latStr := r.URL.Query().Get("lat")
		lngStr := r.URL.Query().Get("lng")

		if id == "" || latStr == "" || lngStr == "" {
			http.Error(w, "Missing params", 400)
			return
		}

		// 2. 执行 UPSERT (更新最新位置)
		// 这一步保证了 /list 接口永远能秒回最新的设备状态
		upsertSQL := `
            INSERT INTO devices (device_id, last_lat, last_lng, last_seen)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (device_id) 
            DO UPDATE SET last_lat=$2, last_lng=$3, last_seen=NOW();`

		_, err := db.Exec(upsertSQL, id, latStr, lngStr)
		if err != nil {
			fmt.Printf("❌ 更新设备状态失败: %v\n", err)
		}

		// 3. 写入历史轨迹 (用于 index.html 绘线)
		historySQL := `
            INSERT INTO driver_history (name, location, created_at)
            VALUES ($1, ST_SetSRID(ST_Point($3, $2), 4326), NOW());`

		db.Exec(historySQL, id, latStr, lngStr)

		w.Write([]byte("Position Synchronized"))
	}
}

func ListDevicesHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 只查询最近 5 分钟内活跃的设备
		rows, err := db.Query("SELECT device_id FROM devices WHERE last_seen > NOW() - INTERVAL '5 minutes'")
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer rows.Close()

		var ids []string
		for rows.Next() {
			var id string
			rows.Scan(&id)
			ids = append(ids, id)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ids)
	}
}

func FencesHandle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	// 使用 ST_AsGeoJSON 将空间对象转为前端可读的 JSON
	query := `SELECT id, name, ST_AsGeoJSON(area) FROM fences`
	rows, err := db.Query(query)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	var features []string
	for rows.Next() {
		var id int
		var name, geomJSON string
		rows.Scan(&id, &name, &geomJSON)

		// 拼装成标准的 GeoJSON Feature 格式
		feature := fmt.Sprintf(`{
            "type": "Feature",
            "properties": {"id": %d, "name": "%s"},
            "geometry": %s
        }`, id, name, geomJSON)
		features = append(features, feature)
	}

	fmt.Fprintf(w, `{"type": "FeatureCollection", "features": [%s]}`, strings.Join(features, ","))
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
	http.HandleFunc("/fences", FencesHandle)

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
