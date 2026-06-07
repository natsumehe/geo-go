// ==========================================
// 🛰️ 自适应通信网关协议
// ==========================================
const BASE_URL  = `${window.location.protocol}//${window.location.host}`;
const WS_URL    = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const SHANGHAI_BOUNDS = [
    [120.85, 30.65], 
    [122.15, 31.95]  
];

// ==========================================
// 🗺️ 初始化地图物理渲染引擎 (赛博朋克暗黑风格)
// ==========================================
const map = new maplibregl.Map({
    container: 'map',
    center: [121.145, 31.445], // 🎯 精准对齐数据老巢
    zoom: 13,
    maxBounds: SHANGHAI_BOUNDS,
    // 💡 官方高质量赛博暗黑主题样式
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
});

map.on('load', () => {
    console.log("🟢 暗黑WebGL画布加载就绪，开始按安全优先级挂载矢量管道...");

    // ------------------------------------------
    // 📦 数据源注册（底表分离）
    // ------------------------------------------
    map.addSource('roads-mvt-source', {
        'type': 'vector',
        'tiles': [ window.location.origin + '/tiles/roads/{z}/{x}/{y}.mvt' ]
    });

    map.addSource('fences-mvt-source', {
        'type': 'vector',
        'tiles': [ window.location.origin + '/tiles/fences/{z}/{x}/{y}.mvt' ]
    });

    // ------------------------------------------
    // 🎨 图层渲染：严格控制上下层序 (Roads在下，Fences在顶)
    // ------------------------------------------
    
    // 1. [底层] 挂载全量自适应道路网线层
    map.addLayer({
        'id': 'roads-layer-line', 
        'type': 'line', 
        'source': 'roads-mvt-source', 
        'source-layer': 'roads', 
        'layout': { 'line-join': 'round', 'line-cap': 'round' },
        'paint': {
            'line-color': [
                'match', ['get', 'highway'],
                'motorway', '#00FFCC', // 高速：荧光青
                'trunk', '#FF9500',    // 国道：明橙
                'primary', '#FFCC00',  // 省道：金黄
                '#3A3A3C'              // 城市内部小路：深夜灰
            ], 
            'line-width': [
                'match', ['get', 'highway'],
                'motorway', 6,
                'trunk', 4,
                'primary', 3,
                1.5
            ],
            'line-opacity': [
                'match', ['get', 'highway'],
                'motorway', 1.0, 
                0.55
            ]
        }
    });

    // 2. [中层] 新增道路名称文字标注图层
    map.addLayer({
        'id': 'roads-layer-text',
        'type': 'symbol',
        'source': 'roads-mvt-source',
        'source-layer': 'roads',
        'layout': {
            'text-field': '{name}', 
            'text-font': ['Noto Sans Regular', 'Open Sans Regular'],
            'text-size': 11,
            'symbol-placement': 'line', 
            'text-keep-upright': true,
            'text-padding': 20
        },
        'paint': {
            'text-color': '#E5E5EA', 
            'text-halo-color': '#1C1C1E', 
            'text-halo-width': 2
        }
    });

    // 3. [顶层] 围栏图层（最后挂载，确保压在所有道路的最上方）
    map.addLayer({
        'id': 'fences-layer-fill', 
        'type': 'fill', 
        'source': 'fences-mvt-source', 
        'source-layer': 'fences', 
        'paint': { 
            'fill-color': '#FF3B30', 
            'fill-opacity': 0.22 
        }
    });

    map.addLayer({
        'id': 'fences-layer-outline', 
        'type': 'line', 
        'source': 'fences-mvt-source', 
        'source-layer': 'fences',
        'paint': { 
            'line-color': '#FF453A', 
            'line-width': 2,
            'line-dasharray': [2, 2] 
        }
    });

    // 初始化其余异步总线
    initDeviceDropdown();
    loadHistoricalAlarms();
    connectWebSocket();
});

// ==========================================
// 📶 业务核心模块
// ==========================================
function initDeviceDropdown() {
    const fetchList = () => {
        fetch(`${BASE_URL}/list`)
            .then(res => res.json())
            .then(devices => {
                const select = document.getElementById('deviceList');
                if (!devices) return;
                select.innerHTML = '<option value="">-- 选择设备查看历史轨迹 --</option>';
                devices.filter(id => id && id.length > 0).forEach(id => {
                    const opt = document.createElement('option');
                    opt.value = id; opt.textContent = `设备 ID: ${id}`;
                    select.appendChild(opt);
                });
            }).catch(err => console.error('❌ 动态设备发现失败:', err));
    };
    fetchList(); setInterval(fetchList, 5000); 
}

function switchDeviceHistory(deviceId) {
    if (!deviceId) return;
    fetch(`${BASE_URL}/history?id=${encodeURIComponent(deviceId)}`)
        .then(res => res.json())
        .then(geoJSON => {
            if (!geoJSON.coordinates || geoJSON.coordinates.length === 0) return;
            const validCoords = geoJSON.coordinates.filter(pt => {
                const lng = pt[0], lat = pt[1];
                const b = SHANGHAI_BOUNDS;
                return (lng >= b[0][0] && lng <= b[1][0] && lat >= b[0][1] && lat <= b[1][1]);
            });
            if (validCoords.length === 0) return;

            if (map.getLayer('track-layer')) map.removeLayer('track-layer');
            if (map.getSource('device-track')) map.removeSource('device-track');

            map.addSource('device-track', {
                'type': 'geojson',
                'data': { 'type': 'Feature', 'geometry': { 'type': 'LineString', 'coordinates': validCoords.slice(-100) } }
            }); 
            map.addLayer({
                'id': 'track-layer', 'type': 'line', 'source': 'device-track',
                'layout': { 'line-join': 'round', 'line-cap': 'round' },
                'paint': { 'line-color': '#FFD60A', 'line-width': 4.5 } 
            });
            map.easeTo({ center: validCoords[validCoords.length - 1], zoom: 14, duration: 500 });
        }).catch(err => console.error('❌ 历史轨迹点查错误:', err));
}

function loadHistoricalAlarms() {
    fetch(`${BASE_URL}/alarms`).then(res => res.json()).then(logs => {
        if (!logs) return; logs.forEach(log => appendAlarmDOM(log.driver, log.fence, log.time));
    }).catch(err => console.error('❌ 拉取报警记录失败:', err));
}

function connectWebSocket() {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'alarm') {
                appendAlarmDOM(data.driver, data.fence, new Date().toLocaleTimeString('zh-CN', { hour12: false }));
            }
        } catch (e) {}
    };
    ws.onclose = () => { setTimeout(connectWebSocket, 5000); };
}

function appendAlarmDOM(driver, fence, time) {
    const logContainer = document.getElementById('alarm-logs');
    if (!logContainer) return;
    const item = document.createElement('div');
    item.className = 'log-item';
    item.innerHTML = `
        <span class="log-time" style="color: #FF453A;">${time}</span>
        <strong>🚨 违规闯区存证</strong><br>
        对象: ${driver} | 区域: ${fence}
    `;
    logContainer.insertBefore(item, logContainer.firstChild);
}

// ==========================================
// 🧭 Valhalla 导航算路总线
// ==========================================
let routingPoints = []; // 存储坐标栈 [起点, 终点]
let routeMarkers = [];  // 存储图面大头针

// 监听地图的点击事件
map.on('click', (e) => {
    if (routingPoints.length >= 2) {
        clearRouting();
    }

    const coords = [e.lngLat.lng, e.lngLat.lat];
    routingPoints.push(coords);

    const markerColor = routingPoints.length === 1 ? '#00FFCC' : '#FF3B30';
    const marker = new maplibregl.Marker({ color: markerColor })
        .setLngLat(coords)
        .addTo(map);
    routeMarkers.push(marker);

    if (routingPoints.length === 2) {
        calculateRoute(routingPoints[0], routingPoints[1]);
    }
});

// 核心函数：向前发请求请求 Valhalla 引擎
function calculateRoute(start, end) {
    const requestJson = {
        locations: [
            { lon: start[0], lat: start[1], type: "break" },
            { lon: end[0], lat: end[1], type: "break" }
        ],
        costing: "auto",
        directions_options: { units: "km", language: "zh-CN" }
    };

    // 🎯 走同源相对路径经过 Go 安全隧道转发
    const url = `/route?json=${encodeURIComponent(JSON.stringify(requestJson))}`;

    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error("导航路径生成失败");
            return res.json();
        })
        .then(data => {
            if (!data.trip || !data.trip.legs || data.trip.legs.length === 0) {
                throw new Error("未解算出合法的拓扑路径");
            }
            // 🎯 默认对齐 Valhalla 官方镜像的 6 位压缩精度
            const coordinates = decodeValhallaShape(data.trip.legs[0].shape);
            
            // 渲染至 WebGL 画布
            renderRouteLine(coordinates);
            
            console.log(`🟢 算路成功：全程 ${data.trip.summary.length} 公里，预计耗时 ${data.trip.summary.time} 秒`);
        })
        .catch(err => console.error("❌ 导航总线报错:", err));
}

// 解压 Valhalla 形状拓扑字符串的核心算法 (标准 6 位精度 Polyline 解码)
function decodeValhallaShape(str) {
    let index = 0, len = str.length;
    let lat = 0, lng = 0;
    let coordinates = [];
    while (index < len) {
        let b, shift = 0, result = 0;
        do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1)); lat += dlat;
        shift = 0; result = 0;
        do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1)); lng += dlng;
        coordinates.push([lng * 1e-6, lat * 1e-6]);
    }
    return coordinates;
}

// 在 WebGL 画布上动态渲染霓虹色电子流导航路径
function renderRouteLine(coordinates) {
    if (map.getLayer('navigation-line')) map.removeLayer('navigation-line');
    if (map.getSource('navigation-source')) map.removeSource('navigation-source');

    map.addSource('navigation-source', {
        'type': 'geojson',
        'data': { 'type': 'Feature', 'geometry': { 'type': 'LineString', 'coordinates': coordinates } }
    });

    // 🎯 鲁棒性加固：动态探测围栏填充层是否存在，严防异步加载时点击引发图层索引白屏死锁
    const beforeLayer = map.getLayer('fences-layer-fill') ? 'fences-layer-fill' : undefined;

    map.addLayer({
        'id': 'navigation-line',
        'type': 'line',
        'source': 'navigation-source',
        'layout': { 'line-join': 'round', 'line-cap': 'round' },
        // 🎯 赛博霓虹粉
        'paint': {
            'line-color': '#FF2D55', 
            'line-width': 6,
            'line-opacity': 0.9
        }
    }, beforeLayer); 
}

function clearRouting() {
    routingPoints = [];
    routeMarkers.forEach(m => m.remove());
    routeMarkers = [];
    if (map.getLayer('navigation-line')) map.removeLayer('navigation-line');
}