-- 1. 强行激活 PostGIS 空间核心拓扑拓展
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. 建立地理围栏基础配置表
CREATE TABLE IF NOT EXISTS fences (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    area GEOMETRY(Polygon, 4326) -- 采用标准的 WGS84 经纬度面要素
);

-- 3. 建立设备轨迹动态采集点表
CREATE TABLE IF NOT EXISTS device_positions (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    t TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    geom GEOMETRY(Point, 4326) -- 采集端回传的 WGS84 点坐标
);

-- 4. 建立空间几何 GiST 索引（极其关键！如果没有索引，MVT 的 && 操作会导致大表全表扫描卡死）
CREATE INDEX IF NOT EXISTS idx_fences_area ON fences USING gist(area);
CREATE INDEX IF NOT EXISTS idx_device_positions_geom ON device_positions USING gist(geom);
CREATE INDEX IF NOT EXISTS idx_device_positions_t ON device_positions(t DESC);

-- 5. 注入黄浦区“外滩禁行区”的真实物理边界多边形数据（闭合环）
TRUNCATE TABLE fences;
INSERT INTO fences (name, area) VALUES (
    '外滩禁行区', 
    ST_GeomFromText('POLYGON((121.485 31.245, 121.500 31.245, 121.500 31.230, 121.485 31.230, 121.485 31.245))', 4326)
);