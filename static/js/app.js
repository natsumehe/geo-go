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
        // 🎯 纠偏防护：防止 CSS 隐形塌陷导致地图容器不显示
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
            // 🎯 精准对焦：江堤路数据中心点上方
            center: [121.2377, 31.8631],    
            zoom: 13,                       
            minZoom: 9, // 🎯 优化：提升最小缩放，防止低层级下与 maxBounds 冲突引发视窗死锁                     
            maxZoom: 18,                    
            maxBounds: this.shanghaiBounds, 
            pitch: 0,                      
            
            // 纯净画布：排除外部底图劫持
            style: {
                "version": 8,
                "sources": {},
                "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
                "layers": [
                    {
                        "id": "pure-dark-background",
                        "type": "background",
                        "paint": { "background-color": "#0d0f12" }
                    }
                ]
            }
        });

        // 监听渲染引擎本身的错误
        this.map.on('error', (e) => {
            console.error("🚨 [WebGL 引擎异常]：", e.error?.message || e);
        });

        this.map.on('load', () => {
            console.log("🟢 WebGL 空间画布就绪，开始加载本地 MVT 管道...");
            document.getElementById('status').innerText = "纯净画布就绪，正在读取本地线数据...";
            
            const mvtHost = window.location.protocol + '//' + window.location.host;

            // ==========================================
            // 🛰️ 1. 数据源配置：OSM 拓扑路网与地理围栏
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
            // 🎨 2. 图层渲染：构建具备视觉层级的底图
            // ==========================================
            
            // 2.1 基础路网线层
            this.map.addLayer({
                'id': 'roads-layer-line', 
                'type': 'line', 
                'source': 'roads-mvt-source', 
                'source-layer': 'roads', // 严格对齐后端图层名
                'layout': { 
                    'line-join': 'round', 
                    'line-cap': 'round',
                    'visibility': 'visible'
                },
                'paint': {
                    // 🎯 优化：根据道路等级（highway）赋予不同的颜色，建立色彩层级
                        'line-color': [
                        'match', ['get', 'highway'],
                        'motorway', '#00FFCC',  // 高速 - 青绿
                        '#004422'               // 缺省兜底值
                    ],
                    // 🎯 优化：结合当前 Zoom 级别与道路类型双重控制宽度，防止低层级线条团塞
                    'line-width': [
                        'interpolate', ['linear'], ['zoom'], 
                        9, [
                            'match', ['get', 'highway'],
                            'motorway', 1.5, 'primary', 1.0, 0.2
                        ],
                        14, [
                            'match', ['get', 'highway'],
                            'motorway', 4.0, 'primary', 3.0, 1.0
                        ],
                        18, [
                            'match', ['get', 'highway'],
                            'motorway', 10.0, 'primary', 8.0, 2.5
                        ]
                    ],
                    // 🎯 优化：低层级适度降低透明度，保障整体感知度
                    'line-opacity': [
                        'interpolate', ['linear'], ['zoom'],
                        9, 0.3,
                        13, 0.95
                    ]
                }
            });

            // 2.2 道路名称文本标注层
            this.map.addLayer({
                'id': 'roads-layer-label',
                'type': 'symbol',
                'source': 'roads-mvt-source',
                'source-layer': 'roads',
                'minzoom': 14, // 🎯 优化：只在放大到高层级时显示文字，避免密集成团
                'layout': {
                    'text-field': ['get', 'name'], 
                    'text-size': [
                        'interpolate', ['linear'], ['zoom'],
                        14, 10,
                        18, 13
                    ],
                    'symbol-placement': 'line', // 🎯 优化：使文字沿道路线走向平滑延伸
                    'text-max-angle': 30,
                    'text-keep-upright': true
                },
                'paint': {
                    'text-color': '#FFFFFF',
                    'text-halo-color': '#0d0f12', // 黑色描边，确保在绿色线之上的可读性
                    'text-halo-width': 1.5
                }
            });

            // 2.3 地理围栏面层与边界线
            this.map.addLayer({
                'id': 'fences-layer-fill', 'type': 'fill', 'source': 'fences-mvt-source', 'source-layer': 'fences',
                'paint': { 'fill-color': '#007cbf', 'fill-opacity': 0.15 }
            });
            this.map.addLayer({
                'id': 'fences-layer-outline', 'type': 'line', 'source': 'fences-mvt-source', 'source-layer': 'fences',
                'paint': { 'line-color': '#00d2ff', 'line-width': 2 }
            });

            // ==========================================
            // 🛰️ 3. 业务图层：实时动态追踪层（置于最顶层）
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