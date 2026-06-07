// ==========================================
// 🛰️ 生产级自适应通信网关协议洗法
// ==========================================
const isHTTPS = window.location.protocol === 'https:';
const BASE_URL  = `${window.location.protocol}//${window.location.host}`;
const WS_URL    = `${isHTTPS ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
const MVT_URL   = `${BASE_URL}/tiles`;

// 上海行政区划数据安全过滤边界
const SHANGHAI_BOUNDS = [
    [120.85, 30.65], 
    [122.15, 31.95]  
];

// ==========================================
// 🗺️ 初始化地图物理渲染引擎 (极简纯黑偏好配置)
// ==========================================
const map = new maplibregl.Map({
    container: 'map',
    center: [121.174, 31.420], // 精准空降：沈海高速嘉定段正上方
    zoom: 13,
    maxBounds: SHANGHAI_BOUNDS,
    
    style: 'https://demotiles.maplibre.org/style.json',
});

// ==========================================
// ⚡ 空间图层资产挂载（MVT 动态矢量瓦片）
// ==========================================
map.on('load', () => {
    console.log("🟢 WebGL 空间画布就绪，开始加载 MVT 管道...");

    // 1. 注册数据源：强行绑定你的 Go 后端多图层瓦片接口
    map.addSource('roads-mvt-source', {
        'type': 'vector',
        'tiles': [ window.location.origin + '/tiles/roads/{z}/{x}/{y}.mvt' ]
    });

    // 2. 挂载地理围栏渲染图层 (淡淡的警示红)
    map.addLayer({
        'id': 'fences-layer-fill', 
        'type': 'fill', 
        'source': 'fences-mvt-source', 
        'source-layer': 'fences',
        'paint': { 'fill-color': '#ff3b30', 'fill-opacity': 0.15 }
    });
    map.addLayer({
        'id': 'fences-layer-outline', 
        'type': 'line', 
        'source': 'fences-mvt-source', 
        'source-layer': 'fences',
        'paint': { 'line-color': '#ff3b30', 'line-width': 1.5 }
    });

    // 3. 核心修复：挂载沈海高速核心线层（荧光青色，确保图层在最上方正常穿透）
    map.addLayer({
        'id': 'roads-layer-line', 
        'type': 'line', 
        'source': 'roads-mvt-source', 
        'source-layer': 'roads', // 🎯 必须和 SQL 里 ST_AsMVT(..., 'roads') 一致
        'layout': { 'line-join': 'round', 'line-cap': 'round' },
        'paint': {
            'line-color': '#00FFCC', // 荧光青
            'line-width': 8,
            'line-opacity': 1.0
        }
    });

    // 初始化基础组件与全双工安全总线
    initDeviceDropdown();
    loadHistoricalAlarms();
    connectWebSocket();
});

// ==========================================
// 📶 业务逻辑：异步轮询发现活跃设备列表
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
                    opt.value = id;
                    opt.textContent = `设备 ID: ${id}`;
                    select.appendChild(opt);
                });
            })
            .catch(err => console.error('❌ 动态设备发现失败:', err));
    };
    fetchList();
    setInterval(fetchList, 5000); 
}

// ==========================================
// 📶 业务逻辑：点查并绘制选中设备的历史轨迹
// ==========================================
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
                'data': {
                    'type': 'Feature',
                    'geometry': { 'type': 'LineString', 'coordinates': validCoords.slice(-100) }
                }
            }); 

            map.addLayer({
                'id': 'track-layer', 
                'type': 'line', 
                'source': 'device-track',
                'layout': { 'line-join': 'round', 'line-cap': 'round' },
                'paint': { 'line-color': '#ffea00', 'line-width': 4 } 
            });

            const lastPoint = validCoords[validCoords.length - 1];
            map.easeTo({ center: lastPoint, zoom: 14, duration: 500 });
        })
        .catch(err => console.error('❌ 历史轨迹点查错误:', err));
}

// ==========================================
// 📶 业务逻辑：异步拉取已有报警存证历史
// ==========================================
function loadHistoricalAlarms() {
    fetch(`${BASE_URL}/alarms`)
        .then(res => res.json())
        .then(logs => {
            if (!logs) return;
            logs.forEach(log => appendAlarmDOM(log.driver, log.fence, log.time));
        })
        .catch(err => console.error('❌ 拉取报警记录失败:', err));
}

// ==========================================
// 🔀 核心总线：生产级加密 WSS 全双工通信器
// ==========================================
function connectWebSocket() {
    const ws = new WebSocket(WS_URL);

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'alarm') {
                const nowTime = new Date().toLocaleTimeString('zh-CN', { hour12: false });
                appendAlarmDOM(data.driver, data.fence, nowTime);
            }
        } catch (e) {}
    };

    ws.onclose = () => {
        setTimeout(connectWebSocket, 5000);
    };
}

function appendAlarmDOM(driver, fence, time) {
    const logContainer = document.getElementById('alarm-logs');
    if (!logContainer) return;
    const item = document.createElement('div');
    item.className = 'log-item';
    item.innerHTML = `
        <span class="log-time">${time}</span>
        <strong>🚨 违规闯区存证</strong><br>
        对象: ${driver}<br>
        区域: ${fence}
    `;
    logContainer.insertBefore(item, logContainer.firstChild);
}