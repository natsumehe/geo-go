/**
 * Geo-Go 指挥中心核心引擎 (MapLibre 高性能 WebGL 引擎解耦版)
 * 🚀 终极定型版：彻底解决底图层级劫持与数据视野错位问题
 */
const App = {
    map: null,
    currentID: null,
    pollTimer: null,
    id: null,

    // 🎯 核心扩展：覆盖 30.65°N ~ 31.95°N，确保崇明岛北部及江堤路等外延数据完全处于可视视野内
    shanghaiBounds: [
        [120.85, 30.65], // 西南角
        [122.15, 31.95]  // 东北角
    ],

    // 为当前浏览器窗口生成全局唯一的设备指纹
    getDeviceID() {
        let id = localStorage.getItem('geo_device_id');
        if (!id) {
            const ua = navigator.userAgent;
            let model = "Unknown_Device";
            if (/iPhone/.test(ua)) model = "iPhone";
            else if (/Android/.test(ua)) {
                const match = ua.match(/Android [\d._]+; ([^;]+)\)/);
                model = match ? match[1].replace(/\s+/g, '_') : "Android";
            }
            id = `${model}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
            localStorage.setItem('geo_device_id', id);
        }
        return id;
    },

    init() {
        this.id = this.getDeviceID();
        const devInfo = document.getElementById('device-info');
        if (devInfo) devInfo.innerText = `DEVICE ID: ${this.id}`;
        
        this.initMap();
        this.startDiscovery();
        this.initWebSocket();
    },

    initMap() {
        this.map = new maplibregl.Map({
            container: 'map',
            
            // 🎯 【铁准对焦】：强行将中心点设置在你数据库中真实存在的江堤路物理坐标正上方（31.8631° N）
            // 彻底解决因初始化在上海市中心（31.23° N）无数据盲区导致的 204 空白问题
            center: [121.2377, 31.8631],    
            
            zoom: 14, // 拉近初始视野，开天窗直接贴脸肉眼观察                      
            minZoom: 5,                     
            maxZoom: 18,                    
            maxBounds: this.shanghaiBounds, 
            pitch: 0, // 初始采用 0 度平面俯视，排除 3D 俯仰角带来的视觉偏差
            
            // 🎯 【底层自愈】：丢弃远程全托管 JSON，改用纯净栅格底图。
            // 杜绝远程服务自带的全球路网劫持通道或吞噬本地图层的渲染层级
            style: {
                "version": 8,
                "sources": {
                    "carto-dark-raster": {
                        "type": "raster",
                        "tiles": [
                            "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
                        ],
                        "tileSize": 256
                    }
                },
                "layers": [
                    {
                        "id": "background-layer",
                        "type": "raster",
                        "source": "carto-dark-raster",
                        "minzoom": 0,
                        "maxzoom": 20
                    }
                ]
            }
        });

        this.map.on('load', () => {
            console.log("WebGL 空间总线就绪，加载本地切片源...");
            document.getElementById('status').innerText = "底图及高性能路网就绪，正在追踪数据...";
            
            const mvtHost = window.location.protocol + '//' + window.location.host;

            // 1. 🔗 空间切片叠加：业务地理围栏 (MVT)
            this.map.addSource('fences-mvt-source', {
                'type': 'vector',
                'tiles': [ mvtHost + '/tiles/fences/{z}/{x}/{y}.mvt' ]
            });
            this.map.addLayer({
                'id': 'fences-layer-fill', 'type': 'fill', 'source': 'fences-mvt-source', 'source-layer': 'fences',
                'paint': { 'fill-color': '#007cbf', 'fill-opacity': 0.15 }
            });
            this.map.addLayer({
                'id': 'fences-layer-outline', 'type': 'line', 'source': 'fences-mvt-source', 'source-layer': 'fences',
                'paint': { 'line-color': '#00d2ff', 'line-width': 2 }
            });

            // 2. 🛰️ 空间切片叠加：OSM 拓扑路网 (MVT)
            // 💡 剥离了所有尾部图层顺序依赖。现在，本图层以绝对优先级强制渲染在 WebGL 顶层画布表面！
            this.map.addSource('roads-mvt-source', {
                'type': 'vector',
                'tiles': [ mvtHost + '/tiles/roads/{z}/{x}/{y}.mvt' ]
            });
            this.map.addLayer({
                'id': 'roads-layer-line', 
                'type': 'line', 
                'source': 'roads-mvt-source', 
                'source-layer': 'roads', // 🎯 严格小写，死锁对齐 Go 里的 ST_AsMVT(..., 'roads')
                'layout': { 
                    'line-join': 'round', 
                    'line-cap': 'round',
                    'visibility': 'visible'
                },
                'paint': {
                    'line-color': '#00FF88', // 强穿透超亮荧光绿
                    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.0, 15, 4.0, 18, 8.0],
                    'line-opacity': 0.95
                }
            }); 

            // 3. 🎯 全量单兵精细化实时轨迹追踪层 (GeoJSON 锁定槽)
            this.map.addSource('device-track', {
                'type': 'geojson',
                'data': { 'type': 'Feature', 'geometry': { 'type': 'LineString', 'coordinates': [] } }
            }); 
            this.map.addLayer({
                'id': 'track-layer', 'type': 'line', 'source': 'device-track',
                'layout': { 'line-join': 'round', 'line-cap': 'round' },
                'paint': { 'line-color': '#ffea00', 'line-width': 4 } // 亮黄色轨迹主线
            });

            this.map.addSource('device-pointer', {
                'type': 'geojson',
                'data': { 'type': 'Feature', 'geometry': { 'type': 'Point', 'coordinates': [0, 0] } }
            });
            this.map.addLayer({
                'id': 'pointer-layer', 'type': 'circle', 'source': 'device-pointer',
                'paint': { 'circle-radius': 7, 'circle-color': '#ff3333', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' }
            });
        });
    },

    startDiscovery() {
        const refreshList = async () => {
            try {
                const res = await fetch('/list');
                const devices = await res.json();
                this.renderCards(devices);
            } catch (e) { console.error("Discovery failed", e); }
        };
        refreshList();
        setInterval(refreshList, 5000); 
    },

    renderCards(devices) {
        const container = document.getElementById('device-swiper');
        if (!container) return;
        const validDevices = devices.filter(d => d && d.length > 0);
        if (validDevices.length === 0) {
            container.innerHTML = '<div style="font-size:12px; color:#666; padding:8px;">等待数据库同步...</div>';
            return;
        }
        container.innerHTML = validDevices.map(id => `
            <div class="swiper-slide ${id === this.currentID ? 'active' : ''}" onclick="App.selectDevice('${id}')">
                <div class="slide-tag">已发现采集端</div>
                <div class="slide-id">${id}</div>
            </div>
        `).join('');

        if (!this.currentID && validDevices.length > 0) {
            this.selectDevice(validDevices[0]);
        }
    },

    selectDevice(id) {
        this.currentID = id;
        document.querySelectorAll('.swiper-slide').forEach(s => {
            const idAttr = s.querySelector('.slide-id')?.innerText;
            s.classList.toggle('active', idAttr === id);
        });

        if (this.pollTimer) clearInterval(this.pollTimer);
        const track = () => this.fetchUpdate(id);
        track();
        this.pollTimer = setInterval(track, 3000); 
    },

    async fetchUpdate(id) {
        try {
            const res = await fetch(`/history?id=${encodeURIComponent(id)}`);
            const data = await res.json();
            if (data.coordinates && data.coordinates.length > 0) {
                this.draw(data.coordinates.slice(-100)); 
            }
        } catch (e) { console.error("Track error", e); }
    },

    draw(coordinates) {
        if (!coordinates || coordinates.length === 0 || !this.map) return;
        const lastPoint = coordinates[coordinates.length - 1];

        const trackSource = this.map.getSource('device-track');
        if (trackSource) {
            trackSource.setData({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coordinates }
            });
        }
        
        const pointerSource = this.map.getSource('device-pointer');
        if (pointerSource) {
            pointerSource.setData({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: lastPoint }
            });
        }
        this.map.easeTo({ center: lastPoint, duration: 500 });
    },

    initWebSocket() {
        const wsProtocol = window.location.protocol === "https:" ? "wss://" : "ws://";
        const wsUrl = wsProtocol + window.location.host + "/ws";
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            document.getElementById('status').innerText = "系统运行正常 (🟢 实时链路通畅)";
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'alarm') {
                    const logContainer = document.getElementById('alarm-logs');
                    const item = document.createElement('div');
                    item.className = 'log-item';
                    item.innerHTML = `<strong>🚨 违规闯区存证</strong><br>对象: ${data.driver}<br>区域: ${data.fence}`;
                    logContainer.insertBefore(item, logContainer.firstChild);
                }
            } catch (e) { console.log(event.data); }
        };

        ws.onclose = () => {
            document.getElementById('status').innerText = "链路意外中断 (🔴 自动重连中...)";
            setTimeout(() => this.initWebSocket(), 5000);
        };
    }
};

// 执行引擎挂载初始化
App.init();