package store

import (
	"database/sql"
	"fmt"
	"log"
)

func GetTileData(db *sql.DB, layerName string, z, x, y int) ([]byte, error) {
	var localTileData []byte
	var dbErr error

	switch layerName {
	case "fences":
		mvtQuery := `
			WITH tilegeom AS (
				SELECT id, name, 
					   ST_AsMVTGeom(
						   ST_Transform(area, 3857), 
						   ST_SetSRID(ST_TileEnvelope($1::int, $2::int, $3::int), 3857), 
						   4096, 64, true
					   ) AS geom
				FROM fences
				WHERE ST_Transform(area, 3857) && ST_SetSRID(ST_TileEnvelope($1::int, $2::int, $3::int), 3857)
			)
			SELECT ST_AsMVT(tilegeom.*, 'fences') FROM tilegeom;`
		dbErr = db.QueryRow(mvtQuery, z, x, y).Scan(&localTileData)

	case "roads":
		var highwayFilter string
		var tolerance float64

		if z < 11 {
			highwayFilter = "highway IN ('motorway', 'trunk')"
			tolerance = 100.0
		} else if z >= 11 && z < 14 {
			highwayFilter = "highway IN ('motorway', 'trunk', 'primary', 'secondary')"
			tolerance = 20.0
		} else {
			highwayFilter = "highway IS NOT NULL"
			tolerance = 0.0
		}

		mvtQuery := fmt.Sprintf(`
			WITH tilegeom AS (
				SELECT osm_id, name, highway,
					   ST_AsMVTGeom(
						   ST_SimplifyPreserveTopology(way_3857, %f), 
						   ST_SetSRID(ST_TileEnvelope($1::int, $2::int, $3::int), 3857), 
						   4096, 64, true
					   ) AS geom
				FROM planet_osm_line
				WHERE %s
				  AND way_3857 && ST_SetSRID(ST_TileEnvelope($1::int, $2::int, $3::int), 3857)
			)
			SELECT COALESCE(ST_AsMVT(tilegeom.*, 'roads'), ''::bytea)::bytea FROM tilegeom;`, tolerance, highwayFilter)

		dbErr = db.QueryRow(mvtQuery, z, x, y).Scan(&localTileData)
		if dbErr != nil {
			log.Printf("[🔎 PostGIS 道路图层查询报错]: %v", dbErr)
		}

	default:
		return nil, fmt.Errorf("layer not found: %s", layerName)
	}

	return localTileData, dbErr
}