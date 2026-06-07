// ==========================================
// 🛰️ 自适应通信网关协议与上海边界
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
    center: [121.234, 31.415], 
    zoom: 10,
    maxBounds: SHANGHAI_BOUNDS,
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
});

map.on('load', () => {
    console.log("🟢 暗黑WebGL画布加载就绪，开始按安全优先级挂载矢量管道...");

    // 📦 数据源注册
    map.addSource('roads-mvt-source', {
        'type': 'vector',
        'tiles': [ window.location.origin + '/tiles/roads/{z}/{x}/{y}.mvt' ]
    });

    map.addSource('fences-mvt-source', {
        'type': 'vector',
        'tiles': [ window.location.origin + '/tiles/fences/{z}/{x}/{y}.mvt' ]
    });

    // 1. [底层] 道路网线层
    map.addLayer({
        'id': 'roads-layer-line', 
        'type': 'line', 
        'source': 'roads-mvt-source', 
        'source-layer': 'roads', 
        'layout': { 'line-join': 'round', 'line-cap': 'round' },
        'paint': {
            'line-color': [
                'match', ['get', 'highway'],
                'motorway', '#00FFCC', 
                'trunk', '#FF9500',    
                'primary', '#FFCC00',  
                '#3A3A3C'              
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

    // 2. [中层] 道路文字标注
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

    // 3. [顶层] 围栏图层
    map.addLayer({
        'id': 'fences-layer-fill', 
        'type': 'fill', 
        'source': 'fences-mvt-source', 
        'source-layer': 'fences', 
        'paint': { 
            'fill-color': '#FF3B30', 
            'fill-opacity': 0.15 
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

    // 初始化外部总线
    initDeviceDropdown();
    connectWebSocket();
});

// ==========================================
// 📶 业务核心模块：采集轨迹（流式渲染至右侧面板）
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

            // 🎯 提取并向右侧轨迹看板灌入采集坐标流
            updateTrackPanel(deviceId, validCoords.slice(-10));
            map.easeTo({ center: validCoords[validCoords.length - 1], zoom: 14, duration: 500 });
        }).catch(err => console.error('❌ 历史轨迹点查错误:', err));
}

// 更新右侧采集轨迹流水
function updateTrackPanel(id, lastCoords) {
    const container = document.getElementById('collected-tracks-box');
    if (!container) return;
    container.innerHTML = `<div style="color:#FFD60A;margin-bottom:8px;">🛰️ 设备 [${id}] 最新采集流:</div>`;
    lastCoords.reverse().forEach((coord, i) => {
        const item = document.createElement('div');
        item.style.fontSize = '12px';
        item.style.borderBottom = '1px dashed #2C2C2E';
        item.style.padding = '4px 0';
        item.innerHTML = `<span style="color:#8E8E93;">[#${i}]</span> 经: ${coord[0].toFixed(5)} | 纬: ${coord[1].toFixed(5)}`;
        container.appendChild(item);
    });
}

// 🎯 升级：实时触发且可物理关闭的违规弹窗
function triggerAlarmPopup(driver, fence) {
    let container = document.getElementById('dynamic-alarm-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'dynamic-alarm-container';
        container.style.position = 'absolute';
        container.style.top = '20px';
        container.style.left = '50%';
        container.style.transform = 'translateX(-50%)';
        container.style.zIndex = '9999';
        document.body.appendChild(container);
    }
    
    const popup = document.createElement('div');
    popup.style.background = 'rgba(28,28,30,0.95)';
    popup.style.border = '2px solid #FF453A';
    popup.style.borderRadius = '8px';
    popup.style.padding = '15px';
    popup.style.color = '#FFF';
    popup.style.boxShadow = '0 0 20px rgba(255,69,58,0.4)';
    popup.style.marginBottom = '10px';
    popup.style.display = 'flex';
    popup.style.justifyContent = 'space-between';
    popup.style.alignItems = 'center';
    popup.style.minWidth = '320px';

    popup.innerHTML = `
        <div>
            <strong style="color:#FF453A;">🚨 实时违规闯区警报</strong><br>
            <span style="font-size:13px;">对象: ${driver} | 区域: ${fence}</span>
        </div>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#8E8E93;font-size:18px;cursor:pointer;padding-left:15px;">✕</button>
    `;
    container.appendChild(popup);
    // 10秒后自动淡出消失
    setTimeout(() => { if (popup) popup.remove(); }, 10000);
}

function connectWebSocket() {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'alarm') {
                triggerAlarmPopup(data.driver, data.fence);
            }
        } catch (e) {}
    };
    ws.onclose = () => { setTimeout(connectWebSocket, 5000); };
}

// ==========================================
// 🧭 Valhalla 导航算路与路书中心
// ==========================================
let routingPoints = []; 
let routeMarkers = [];  

map.on('click', (e) => {
    if (routingPoints.length >= 2) {
        clearRouting();
    }

    const coords = [e.lngLat.lng, e.lngLat.lat];
    routingPoints.push(coords);

    // 🎯 动态更新坐标提取面板
    if (routingPoints.length === 1) {
        document.getElementById('start-coord-input').value = `${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`;
    } else if (routingPoints.length === 2) {
        document.getElementById('end-coord-input').value = `${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`;
    }

    const markerColor = routingPoints.length === 1 ? '#00FFCC' : '#FF3B30';
    const marker = new maplibregl.Marker({ color: markerColor })
        .setLngLat(coords)
        .addTo(map);
    routeMarkers.push(marker);

    if (routingPoints.length === 2) {
        calculateRoute(routingPoints[0], routingPoints[1]);
    }
});

function calculateRoute(start, end) {
    const requestJson = {
        locations: [
            { lon: start[0], lat: start[1], type: "break" },
            { lon: end[0], lat: end[1], type: "break" }
        ],
        costing: "auto",
        directions_options: { units: "km", language: "zh-CN" }
    };

    const url = `/route?json=${encodeURIComponent(JSON.stringify(requestJson))}`;

    fetch(url)
        .then(res => { if (!res.ok) throw new Error("导航路径生成失败"); return res.json(); })
        .then(data => {
            if (!data.trip || !data.trip.legs || data.trip.legs.length === 0) throw new Error("未解算出合法的拓扑路径");
            
            const leg = data.trip.legs[0];
            const coordinates = decodeValhallaShape(leg.shape);
            renderRouteLine(coordinates);
            
            // 🎯 全量提取路书：总公里数、耗时、转向动作列表
            updateNavigationPanel(data.trip.summary, leg.maneuvers);
        })
        .catch(err => console.error("❌ 导航总线报错:", err));
}

// 渲染多级路书及转弯动作至右侧面板
function updateNavigationPanel(summary, maneuvers) {
    const container = document.getElementById('navigation-manifest-box');
    if (!container) return;
    
    let html = `
        <div style="background:rgba(0,255,204,0.1);padding:8px;border-radius:4px;margin-bottom:10px;border-left:4px solid #00FFCC;">
            🚗 <b>全长</b>: ${summary.length.toFixed(2)} km | <b>预计耗时</b>: ${(summary.time/60).toFixed(1)} 分钟
        </div>
        <div style="max-height: 250px; overflow-y: auto;">
    `;

    maneuvers.forEach((m, idx) => {
        html += `
            <div style="font-size:12px;padding:6px 0;border-bottom:1px solid #2C2C2E;display:flex;align-items:flex-start;">
                <span style="color:#FF2D55;margin-right:8px;font-weight:bold;">${idx + 1}.</span>
                <div>
                    <div>${m.instruction}</div>
                    <span style="color:#8E8E93;font-size:11px;">🛣️ 行进 ${m.length.toFixed(2)} km (耗时 ${m.time} 秒)</span>
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

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

function renderRouteLine(coordinates) {
    if (map.getLayer('navigation-line')) map.removeLayer('navigation-line');
    if (map.getSource('navigation-source')) map.removeSource('navigation-source');

    map.addSource('navigation-source', {
        'type': 'geojson',
        'data': { 'type': 'Feature', 'geometry': { 'type': 'LineString', 'coordinates': coordinates } }
    });

    const beforeLayer = map.getLayer('fences-layer-fill') ? 'fences-layer-fill' : undefined;
    map.addLayer({
        'id': 'navigation-line', 'type': 'line', 'source': 'navigation-source',
        'layout': { 'line-join': 'round', 'line-cap': 'round' },
        'paint': { 'line-color': '#FF2D55', 'line-width': 6, 'line-opacity': 0.9 }
    }, beforeLayer); 
}

function clearRouting() {
    routingPoints = [];
    routeMarkers.forEach(m => m.remove());
    routeMarkers = [];
    if (map.getLayer('navigation-line')) map.removeLayer('navigation-line');
    document.getElementById('start-coord-input').value = '';
    document.getElementById('end-coord-input').value = '';
    document.getElementById('navigation-manifest-box').innerHTML = '<span style="color:#8E8E93;">等待地图两点交互算路...</span>';
}