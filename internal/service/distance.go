package service

import (
	"database/sql"
	"fmt"
	"log"
	"math"

	wsHub "geo/internal/service/websocket"
)

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

func CheckFence(db *sql.DB, hub *wsHub.Hub, driverID string, lng, lat float64) {
	if db == nil {
		return
	}
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
		if insertErr == nil && hub != nil {
			hub.NotifyClients(fmt.Sprintf(`{"type":"alarm","driver":"%s","fence":"%s"}`, driverID, fenceName))
		}
	}
}