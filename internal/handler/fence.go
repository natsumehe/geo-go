package handler

import (
	"fmt"
	"net/http"
	"strings"
)

// /fences: 获取全量围栏图层 (GeoJSON FeatureCollection)
func (h *ServerHandler) Fences(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if h.DB == nil {
		fmt.Fprintf(w, `{"type": "FeatureCollection", "features": []}`)
		return
	}

	query := `SELECT id, name, ST_AsGeoJSON(area) FROM fences`
	rows, err := h.DB.Query(query)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	var features []string
	for rows.Next() {
		var id int
		var name, geomJSON string
		if err := rows.Scan(&id, &name, &geomJSON); err == nil {
			feature := fmt.Sprintf(`{
                "type": "Feature",
                "properties": {"id": %d, "name": "%s"},
                "geometry": %s
            }`, id, name, geomJSON)
			features = append(features, feature)
		}
	}

	fmt.Fprintf(w, `{"type": "FeatureCollection", "features": [%s]}`, strings.Join(features, ","))
}

// /alarms: 实时告警日志查询
func (h *ServerHandler) Alarms(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if h.DB == nil {
		fmt.Fprint(w, `[]`)
		return
	}

	rows, err := h.DB.Query(`
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
		if err := rows.Scan(&d, &f, &t); err == nil {
			results = append(results, fmt.Sprintf(`{"driver":"%s", "fence":"%s", "time":"%s"}`, d, f, t))
		}
	}
	fmt.Fprintf(w, "[%s]", strings.Join(results, ","))
}