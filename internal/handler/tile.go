package handler

import (
	"net/http"
	"strconv"
	"strings"

	"geo/internal/store"
)

// /tiles/: MVT 矢量瓦片响应
func (h *ServerHandler) Tile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/tiles/")
	path = strings.ReplaceAll(path, ".mvt", "")
	parts := strings.Split(path, "/")
	if len(parts) < 4 {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	layerName := parts[0]
	z, errZ := strconv.Atoi(parts[1])
	x, errX := strconv.Atoi(parts[2])
	yStr := strings.Split(parts[3], "?")[0]
	y, errY := strconv.Atoi(yStr)

	if errZ != nil || errX != nil || errY != nil {
		http.Error(w, "Invalid Tile Coordinates", http.StatusBadRequest)
		return
	}

	localTileData, dbErr := store.GetTileData(h.DB, layerName, z, x, y)
	if dbErr != nil || len(localTileData) == 0 {
		w.Header().Del("Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
	w.Header().Set("Cache-Control", "public, max-age=600")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(localTileData)
}