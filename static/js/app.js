// ==========================================
// 🛰️ 生产级网络拓扑自适应总线配置
// ==========================================
const isHTTPS = window.location.protocol === 'https:';
// 动态拼装后端基础 API 根路径与 WebSocket 安全加密链路
const BASE_URL  = `${window.location.protocol}//${window.location.host}`;
const WS_URL    = `${isHTTPS ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
const MVT_URL   = `${BASE_URL}/tiles`;

// ==========================================
// 🗺️ 初始化地图物理渲染引擎
// ==========================================

const map = new maplibregl.Map({
    container: 'map',
    style: {
        "version": 8,
        "sources": {
            "osm-tiles": {
                "type": "raster",
                "tiles": [
                    "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
                    "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png"
                ],
                "tileSize": 256
            }
        },
        "layers": [{
            "id": "osm-layer",
            "type": "raster",
            "source": "osm-tiles",
            "minzoom": 0,
            "maxzoom": 19
        }]
    },
    center: [121.50, 31.23], // 默认锚定中心点
    zoom: 11,
    pitch: 45 // 给予大屏 45 度极客空间俯仰角
});

// ==========================================
// ⚡ 空间图层资产挂载（MVT 动态矢量瓦片双通道）
// ==========================================
map.on('load', () => {
	console.log("🟢 渲染引擎初始化就绪，开始挂载 PostGIS 动态矢量管道...");

    // 🎯 图层通道 1：地理电子围栏面要素 (fences)
    map.addSource('fences_mvt', {
        type: 'vector',
        tiles: [`${MVT_URL}/fences/{z}/{x}/{y}.mvt`]
    });
    map.addLayer({
        id: 'fences-layer',
        type: 'fill',
        source: 'fences_mvt',
        'source-layer': 'fences',
        paint: {
            'fill-color': '#ff3b30',
            'fill-opacity': 0.25,
            'fill-outline-color': '#ff3b30'
        }
    });

    // 🎯 图层通道 2：沈海高速特定切片路网 (roads)
    map.addSource('roads_mvt', {
        type: 'vector',
        tiles: [`${MVT_URL}/roads/{z}/{x}/{y}.mvt`]
    });
    map.addLayer({
        id: 'roads-layer',
        type: 'line',
        source: 'roads_mvt',
        'source-layer': 'roads',
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-color': '#00d2ff',
            'line-width': 4,
            'line-blur': 1 // 赋予高速路网极光发光特效
        }
    });

    // 动态拉取当前数据库已激活的车辆/采集端下拉列表
    initDeviceDropdown();
    // 拉取历史存证的前 10 条报警日志
    loadHistoricalAlarms();
    // 激活全双工 WSS 实时加密总线
    connectWebSocket();
});

// ==========================================
// 📶 业务逻辑：动态发现采集端设备列表
// ==========================================
function initDeviceDropdown() {
    fetch(`${BASE_URL}/list`)
        .then(res => res.json())
        .then(devices => {
            const select = document.getElementById('deviceList');
            if (!devices) return;
            devices.forEach(id => {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = `设备 ID: ${id}`;
                select.appendChild(opt);
            });
        })
        .catch(err => console.error('❌ 获取活跃采集端失败:', err));
}

// ==========================================
// 📶 业务逻辑：点查并绘制选中设备的历史轨迹
// ==========================================
function switchDeviceHistory(deviceId) {
    if (!deviceId) return;

    fetch(`${BASE_URL}/history?id=${deviceId}`)
        .then(res => res.json())
        .then(geoJSON => {
            // 防御清除机制：如果已经存在历史轨迹图层，先将其卸载掉
            if (map.getLayer('history-line')) map.removeLayer('history-line');
            if (map.getSource('history_source')) map.removeSource('history_source');

            // 挂载动态点查出来的 GeoJSON 线串
            map.addSource('history_source', {
                type: 'geojson',
                data: geoJSON
            });

            map.addLayer({
                id: 'history-line',
                type: 'line',
                source: 'history_source',
                paint: {
                    'line-color': '#ffcc00',
                    'line-width': 5,
                    'line-dasharray': [2, 1] // 虚线流动动效衬托
                }
            });

            // 智能纠偏：自动将地图视口平滑弹射移动到当前车辆的轨迹中心点
            if (geoJSON.coordinates && geoJSON.coordinates.length > 0) {
                const lastIdx = geoJSON.coordinates.length - 1;
                map.flyTo({
                    center: geoJSON.coordinates[lastIdx],
                    zoom: 13,
                    essential: true
                });
            }
        })
        .catch(err => console.error('❌ 点查历史时序数据失败:', err));
}

// ==========================================
// 📶 业务逻辑：异步拉取已有报警存证历史
// ==========================================
function loadHistoricalAlarms() {
    fetch(`${BASE_URL}/alarms`)
        .then(res => res.json())
        .then(logs => {
            if (!logs) return;
            // 倒序排列，保证最新时间发生的在最上方
            logs.forEach(log => appendAlarmDOM(log.driver, log.fence, log.time));
        })
        .catch(err => console.error('❌ 拉取报警存证失败:', err));
}

// ==========================================
// 🔀 核心总线：生产级加密 WSS 全双工通信器
// ==========================================
function connectWebSocket() {
    console.log(`🔒 正在向安全网关发起握手链路: ${WS_URL}`);
    const ws = new WebSocket(WS_URL);

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'alarm') {
                const nowTime = new Date().toLocaleTimeString('zh-CN', { hour12: false });
                // 触发实时大警消息轰炸并写入 DOM 
                appendAlarmDOM(data.driver, data.fence, nowTime);
            }
        } catch (e) {
			// 过滤心跳或非标准协议包
        }
    };

	// 生产级高可用：遭遇恶劣公网环境网络物理闪断时，每隔 5000ms 自动无限重连兜底
    ws.onclose = () => {
        console.warn('⚠️ WSS 生产总线断开，正在尝试启动边缘自愈重连...');
        setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = (err) => {
        console.error('❌ WSS 链路异常阻断:', err);
    };
}

// 向右侧控制台插入报警条目的公用渲染组件
function appendAlarmDOM(driver, fence, time) {
    const logContainer = document.getElementById('alarmLog');
    const item = document.createElement('div');
    item.className = 'alarm-item';
    item.innerHTML = `
        <span class="alarm-time">${time}</span>
        <strong>🚨 入侵触发:</strong> 设备 <span>${driver}</span> 非法穿行于 <span>${fence}</span> 监控区内！
    `;
    // 始终把最新回传的报警记录推至视窗最顶端
    logContainer.insertBefore(item, logContainer.firstChild);
}