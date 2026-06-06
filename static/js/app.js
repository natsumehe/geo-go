const App = {
    map: null,
    currentID: null,
    pollTimer: null,
    id: null,

    // 上海物理数据有效边界
    shanghaiBounds: [
        [120.85, 30.65], 
        [122.15, 31.95]  
    ],

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
        // 防止 CSS 隐形塌陷导致地图容器不显示
        const mapEl = document.getElementById('map');
        if (mapEl) {
            mapEl.style.width = '100vw';
            mapEl.style.height = '100vh';
            mapEl.style.position = 'absolute';
            mapEl.style.backgroundColor = '#0a0a0a'; 
        }

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
            // 🎯 精准对焦：调整至沈海高速目标路段上方
            center: [121.18, 31.22],    
            zoom: 12,                       
            minZoom: 9,                                         
            maxZoom: 18,                    
            maxBounds: this.shanghaiBounds, 
            pitch: 0,                      
            
            style: {
                "version": 8,
                "sources": {},
                "layers": [
                    {
                        "id": "pure-dark-background",
                        "type": "background",
                        "paint": { "background-color": "#0d0f12" }
                    }
                ]
            }
        });

        this.map.on('error', (e) => {
            console.error("🚨 [WebGL 引擎异常]：", e.error?.message || e);
        });

        this.map.on('load', () => {
            console.log("🟢 WebGL 空间画布就绪，开始加载 MVT 管道...");
            document.getElementById('status').innerText = "纯净画布就绪，正在读取数据...";
            
            const mvtHost = window.location.protocol + '//' + window.location.host;

            // ==========================================
            // 🛰️ 1. 数据源配置：MVT 管道
            // ==========================================
            this.map.addSource('roads-mvt-source', {
                'type': 'vector',
                'tiles': [ mvtHost + '/tiles/roads/{z}/{x}/{y}.mvt' ],
                'minzoom': 9,
                'maxzoom': 18
            });

            this.map.addSource('fences-mvt-source', {
                'type': 'vector',
                'tiles': [ mvtHost + '/tiles/fences/{z}/{x}/{y}.mvt' ]
            });

            // ==========================================
            // 🎨 2. 图层渲染：沈海高速与地理围栏
            // ==========================================
            
            // 2.1 核心路网线层（面向特规过滤后的沈海高速）
            this.map.addLayer({
                'id': 'roads-layer-line', 
                'type': 'line', 
                'source': 'roads-mvt-source', 
                'source-layer': 'roads', // 严格对齐后端 ST_AsMVT 中的图层标识
                'layout': { 
                    'line-join': 'round', 
                    'line-cap': 'round'
                },
                'paint': {
                    'line-color': '#00FFCC', // 荧光青色，确保暗色底图下绝对可见
                    'line-width': [
                        'interpolate', ['linear'], ['zoom'], 
                        9, 3.0,
                        14, 6.0,
                        18, 10.0
                    ],
                    'line-opacity': 1.0 // 全透明度显现
                }
            });

            // 2.2 道路名称文本标注层
            this.map.addLayer({
                'id': 'roads-layer-label',
                'type': 'symbol',
                'source': 'roads-mvt-source',
                'source-layer': 'roads',
                'minzoom': 11, 
                'layout': {
                    'text-field': ['get', 'name'], 
                    'text-size': [
                        'interpolate', ['linear'], ['zoom'],
                        11, 10,
                        18, 14
                    ],
                    'symbol-placement': 'line', 
                    'text-keep-upright': true
                },
                'paint': {
                    'text-color': '#FFFFFF',
                    'text-halo-color': '#0d0f12', 
                    'text-halo-width': 2.0
                }
            });

            // 2.3 地理围栏面层与边界线
            this.map.addLayer({
                'id': 'fences-layer-fill', 'type': 'fill', 'source': 'fences-mvt-source', 'source-layer': 'fences',
                'paint': { 'fill-color': '#007cbf', 'fill-opacity': 0.2 }
            });
            this.map.addLayer({
                'id': 'fences-layer-outline', 'type': 'line', 'source': 'fences-mvt-source', 'source-layer': 'fences',
                'paint': { 'line-color': '#00d2ff', 'line-width': 2 }
            });

            // ==========================================
            // 🛰️ 3. 业务图层：实时动态追踪层
            // ==========================================
            this.map.addSource('device-track', {
                'type': 'geojson',
                'data': { 'type': 'Feature', 'geometry': { 'type': 'LineString', 'coordinates': [] } }
            }); 
            this.map.addLayer({
                'id': 'track-layer', 'type': 'line', 'source': 'device-track',
                'layout': { 'line-join': 'round', 'line-cap': 'round' },
                'paint': { 'line-color': '#ffea00', 'line-width': 4 } 
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

        // 🎯 防御校验：避免轨迹中混入 [0,0] 等非法坐标触发 maxBounds 死锁崩溃
        const lng = lastPoint[0];
        const lat = lastPoint[1];
        const b = this.shanghaiBounds;
        if (lng < b[0][0] || lng > b[1][0] || lat < b[0][1] || lat > b[1][1]) {
            console.warn(`⚠️ 拦截到越界轨迹坐标: [${lng}, ${lat}]`);
            return; 
        }

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

App.init();