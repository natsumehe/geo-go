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

-- 1. 添加一个专门存储 EPSG:3857 几何图形的列
ALTER TABLE planet_osm_line ADD COLUMN IF NOT EXISTS way_3857 geometry(Geometry, 3857);

-- 2. 将原有的 way 数据一次性转换并灌入新列（数据量大时可能需要几分钟，请耐心等待）
UPDATE planet_osm_line SET way_3857 = ST_Transform(way, 3857) WHERE way IS NOT NULL;

-- 3. 为这个新列建立高效率的 GIST 空间索引（这是后续彻底免除全表扫描的关键）
CREATE INDEX IF NOT EXISTS planet_osm_line_way3857_idx ON planet_osm_line USING gist(way_3857);

-- 4. 释放空间并清理碎片
VACUUM ANALYZE planet_osm_line;


-- 1. 激活 btree_gist 核心扩展（需要超级用户权限，如 postgres 账号）
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. 重新执行刚才失败的复合索引创建语句（权限补全后即可完美通行）
CREATE INDEX IF NOT EXISTS planet_osm_line_way3857_highway_idx 
ON planet_osm_line USING gist(way_3857, highway);

-- 3. 重新统计信息
VACUUM ANALYZE planet_osm_line;