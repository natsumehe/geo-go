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

type DeviceFilters struct {
	LatKF *filters.KalmanFilter
	LngKF *filters.KalmanFilter
}

var kfStore = sync.Map{}

// 🎯 修复 1：WebSocket 放开跨域，并引入互斥锁，彻底断绝高并发下的崩溃隐患
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}
var (
	clients   = make(map[*websocket.Conn]bool)
	clientsMu sync.RWMutex
)

func WsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf(" [❌ WS 升级失败]: %v", err)
		return
	}
	clientsMu.Lock()
	clients[conn] = true
	clientsMu.Unlock()

	// 保持连接，读取客户端心跳，断开时自动安全注销
	go func(c *websocket.Conn) {
		defer func() {
			c.Close()
			clientsMu.Lock()
			delete(clients, c)
			clientsMu.Unlock()
		}()
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				break
			}
		}
	}(conn)
}

func notifyClients(msg string) {
	clientsMu.RLock()
	defer clientsMu.RUnlock()
	for client := range clients {
		go func(c *websocket.Conn) {
			err := c.WriteMessage(websocket.TextMessage, []byte(msg))
			if err != nil {
				c.Close()
				clientsMu.Lock()
				delete(clients, c)
				clientsMu.Unlock()
			}
		}(client)
	}
}

func HaversineDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000
	phi1 := lat1 * math.Pi / 180
	phi2 := lat2 * math.Pi / 180
	deltaPhi := (lat2 - lat1) * math.Pi / 180
	deltaLambda := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(deltaPhi/2)*math.Sin(deltaPhi/2) +
		math.Cos(phi1)*math.Cos(phi2)*
			math.Sin(deltaLambda/2)*math.Sin(deltaLambda/2)
	return R * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func checkFence(driverID string, lng, lat float64) {
	var fenceName string
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
		if insertErr == nil {
			notifyClients(fmt.Sprintf(`{"type":"alarm","driver":"%s","fence":"%s"}`, driverID, fenceName))
		}
	}
}

func UpdateHandle(w http.ResponseWriter, r *http.Request) {
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

	valKF, _ := kfStore.LoadOrStore(id, &DeviceFilters{
		LatKF: &filters.KalmanFilter{LastValue: lat, P: 1.0, Q: 0.000001, R: 0.0001},
		LngKF: &filters.KalmanFilter{LastValue: lng, P: 1.0, Q: 0.000001, R: 0.0001},
	})
	kf := valKF.(*DeviceFilters)

	smoothLat := kf.LatKF.SmartUpdate(lat, 20.0)
	smoothLng := kf.LngKF.SmartUpdate(lng, 20.0)

	if rdb != nil {
		rdb.GeoAdd(ctx, "drivers:live", &redis.GeoLocation{
			Name: id, Longitude: smoothLng, Latitude: smoothLat,
		})
	}

	shouldWriteHistory := true
	valCache, ok := posCache.Load(id)
	if ok {
		last := valCache.(LastPos)
		dist := HaversineDistance(last.Lat, last.Lng, smoothLat, smoothLng)
		if dist < 3.0 && time.Since(last.Timestamp) < 10*time.Second {
			shouldWriteHistory = false
		}
	}

	go func(dID string, rawLo, rawLa, smLo, smLa float64, isMoving bool) {
		if db != nil {
			rawSQL := `INSERT INTO driver_raw_data (name, location, provider, accuracy, created_at)
                       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), 'gps', 20.0, NOW())`
			_, _ = db.Exec(rawSQL, dID, rawLo, rawLa)

			if isMoving {
				historySQL := `INSERT INTO driver_history (name, location, provider, accuracy, created_at) 
                               VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), 'gps', 20.0, NOW())`
				_, _ = db.Exec(historySQL, dID, smLo, smLa)

				posCache.Store(dID, LastPos{Lat: smLa, Lng: smLo, Timestamp: time.Now()})
				checkFence(dID, smLo, smLa)
			}
		}
	}(id, lng, lat, smoothLng, smoothLat, shouldWriteHistory)

	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "OK: %s Location Filtered", id)
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
            ORDER BY created_at DESC LIMIT 100
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
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ids)
}

func FencesHandle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

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
	connStr := os.Getenv("DB_URL")
	if connStr == "" {
		connStr = "postgres://docker:floder123@172.17.0.1:5432/gis_db?sslmode=disable"
	}
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "redis:6379"
	}

	rdb = redis.NewClient(&redis.Options{Addr: redisAddr})

	var err error
	db, err = sql.Open("postgres", connStr)
	if err != nil {
		log.Fatalf("❌ 数据库驱动加载失败: %v", err)
	}

	// 保留你原本健壮的数据库连接探针
	for i := 0; i < 5; i++ {
		err = db.Ping()
		if err == nil {
			fmt.Println("✅ 数据库连接成功！")
			break
		}
		fmt.Printf("⚠️ 数据库连接尝试 (%d/5) 失败: %v，等待重试...\n", i+1, err)
		time.Sleep(2 * time.Second)
	}

	http.HandleFunc("/update", UpdateHandle)
	http.HandleFunc("/history", HistoryHandle)
	http.HandleFunc("/alarms", AlarmsHandle)
	http.HandleFunc("/list", ListHandle)
	http.HandleFunc("/fences", FencesHandle)
	http.HandleFunc("/ws", WsHandler)

	// 🎯 修复 2：重写高性能、索引友好型 MVT 原生矢量切片（解决原底图拉取问题）
	http.HandleFunc("/tiles/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/tiles/")
		path = strings.TrimSuffix(path, ".mvt")
		parts := strings.Split(path, "/")
		if len(parts) < 4 {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}

		layerName := parts[0]
		z, _ := strconv.Atoi(parts[1])
		x, _ := strconv.Atoi(parts[2])
		y, _ := strconv.Atoi(parts[3])

		var mvtQuery string
		switch layerName {
		case "fences":
			mvtQuery = `
				WITH tilegeom AS (
					SELECT id, name, ST_AsMVTGeom(ST_Transform(area, 3857), ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom
					FROM fences
					WHERE area && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)
				)
				SELECT ST_AsMVT(tilegeom.*, 'fences') FROM tilegeom;`
		case "history":
			mvtQuery = `
				WITH tilegeom AS (
					SELECT name, ST_AsMVTGeom(ST_Transform(location, 3857), ST_TileEnvelope($1, $2, $3), 4096, 64, true) AS geom
					FROM driver_history
					WHERE location && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)
				)
				SELECT ST_AsMVT(tilegeom.*, 'history') FROM tilegeom;`
		default:
			http.Error(w, "Layer not found", http.StatusNotFound)
			return
		}

		var tileData []byte
		err := db.QueryRow(mvtQuery, z, x, y).Scan(&tileData)
		if err != nil || len(tileData) == 0 {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(tileData)
	})

	// 🎯 保留你原汁原味的容器绝对路径双重探针
	staticDir := "/app/static"
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		staticDir = "./static"
	}
	http.Handle("/", http.FileServer(http.Dir(staticDir)))

	// 🎯 保留你原汁原味的 8080 与 443(TLS) 并行监听机制
	go func() {
		fmt.Println("🔓 HTTP 备用服务启动: 8080")
		_ = http.ListenAndServe(":8080", nil)
	}()

	fmt.Println("🔒 HTTPS 安全服务准备启动: 443")
	err = http.ListenAndServeTLS(":443", "/ssl/cert.pem", "/ssl/cert.key", nil)
	if err != nil {
		log.Fatalf("❌ HTTPS 启动失败 (请检查 /ssl 路径与证书): %v", err)
	}
}
