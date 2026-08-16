package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"geo/internal/filter"
	"geo/internal/model"
	"geo/internal/service"
)

// /list: 获取设备名称列表
func (h *ServerHandler) List(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if h.DB == nil {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("[]"))
		return
	}

	rows, err := h.DB.Query("SELECT DISTINCT name FROM driver_history WHERE name IS NOT NULL AND name != ''")
	if err != nil {
		log.Printf("[❌ ListHandle 查询失败]: %v", err)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("[]"))
		return
	}
	defer rows.Close()

	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil && strings.TrimSpace(id) != "" {
			ids = append(ids, strings.TrimSpace(id))
		}
	}

	data, err := json.Marshal(ids)
	if err != nil {
		w.Write([]byte("[]"))
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// /update: 位置上报 + 卡尔曼平滑 + 静止降噪
func (h *ServerHandler) Update(w http.ResponseWriter, r *http.Request) {
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

	valKF, _ := h.KfStore.LoadOrStore(id, &model.DeviceFilters{
		LatKF:    &filter.KalmanFilter{LastValue: lat, P: 1.0, Q: 0.000001, R: 0.0001},
		LngKF:    &filter.KalmanFilter{LastValue: lng, P: 1.0, Q: 0.000001, R: 0.0001},
		LastSeen: time.Now(),
	})
	kf := valKF.(*model.DeviceFilters)
	kf.LastSeen = time.Now()

	smoothLat := kf.LatKF.SmartUpdate(lat, 20.0)
	smoothLng := kf.LngKF.SmartUpdate(lng, 20.0)

	if h.RDB != nil {
		h.RDB.GeoAdd(context.Background(), "drivers:live", &redis.GeoLocation{
			Name: id, Longitude: smoothLng, Latitude: smoothLat,
		})
	}

	shouldWriteHistory := true
	valCache, ok := h.PosCache.Load(id)
	if ok {
		last := valCache.(model.LastPos)
		dist := service.HaversineDistance(last.Lat, last.Lng, smoothLat, smoothLng)
		if dist < 3.0 && time.Since(last.Timestamp) < 10*time.Second {
			shouldWriteHistory = false
		}
	}

	go func(dID string, rawLo, rawLa, smLo, smLa float64, isMoving bool) {
		if h.DB == nil {
			return
		}
		rawSQL := `INSERT INTO driver_raw_data (name, location, provider, accuracy, created_at)
                   VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), 'gps', 20.0, NOW())`
		_, _ = h.DB.Exec(rawSQL, dID, rawLo, rawLa)

		if isMoving {
			historySQL := `INSERT INTO driver_history (name, location, provider, accuracy, created_at) 
                           VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), 'gps', 20.0, NOW())`
			_, _ = h.DB.Exec(historySQL, dID, smLo, smLa)

			h.PosCache.Store(dID, model.LastPos{Lat: smLa, Lng: smLo, Timestamp: time.Now()})
			service.CheckFence(h.DB, h.Hub, dID, smLo, smLa)
		}
	}(id, lng, lat, smoothLng, smoothLat, shouldWriteHistory)

	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "OK: %s Location Filtered", id)
}

// /history: 历史轨迹 GeoJSON LineString 查询
func (h *ServerHandler) History(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "ID Required", http.StatusBadRequest)
		return
	}

	query := `
        SELECT COALESCE(ST_AsGeoJSON(ST_MakeLine(sub.location ORDER BY sub.created_at ASC)), '{"type": "LineString", "coordinates": []}') 
        FROM (
            SELECT location, created_at FROM driver_history 
            WHERE name = $1 
            ORDER BY created_at DESC LIMIT 100
        ) AS sub`

	var geoJSON string
	err := h.DB.QueryRow(query, id).Scan(&geoJSON)
	if err != nil {
		geoJSON = `{"type": "LineString", "coordinates": []}`
	}
	fmt.Fprint(w, geoJSON)
}