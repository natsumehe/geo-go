/**
 * Geo-Go 指挥中心核心引擎 (MapLibre 高性能 WebGL 纯净定型版)
 * 🚀 换个思路：剔除所有外部依赖，直接读取并诊断本地 MVT 线数据
 */
const App = {
    map: null,
    currentID: null,
    pollTimer: null,
    id: null,

    // 确定物理数据的有效边界
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
        // 🎯 纠偏防护：强行对地图容器挂载物理宽高，防止 CSS 隐形塌陷导致不显示
        const mapEl = document.getElementById('map');
        if (mapEl) {
            mapEl.style.width = '100vw';
            mapEl.style.height = '100vh';
            mapEl.style.position = 'absolute';
            mapEl.style.backgroundColor = '#0a0a0a'; // 纯黑底色大盘
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
            // 🎯 【精准对焦】：锁定在江堤路数据中心点上方
            center: [121.2377, 31.8631],    
            zoom: 13,                       
            minZoom: 2,                     
            maxZoom: 18,                    
            maxBounds: this.shanghaiBounds, 
            pitch: 0,                      
            
            // 🎯 【纯净画布】：彻底不加载外部底图，只生成一个纯黑的矢量底盘上下文，排除任何图层劫持
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

        // 监听渲染引擎本身的错误（如 WebGL 上下文丢包、MVT 解析失败等）
        this.map.on('error', (e) => {
            console.error("🚨 [WebGL 引擎异常]：", e.error?.message || e);
        });

        this.map.on('load', () => {
            console.log("🟢 WebGL 空间画布就绪，开始加载本地 MVT 管道...");
            document.getElementById('status').innerText = "纯净画布就绪，正在读取本地线数据...";
            
            const mvtHost = window.location.protocol + '//' + window.location.host;

            // ==========================================
            // 🛰️ 核心读取：OSM 拓扑路网矢量源 (MVT)
            // ==========================================
            this.map.addSource('roads-mvt-source', {
                'type': 'vector',
                'tiles': [ mvtHost + '/tiles/roads/{z}/{x}/{y}.mvt' ],
                'minzoom': 2,
                'maxzoom': 18
            });

            // 挂载线渲染画笔
            this.map.addLayer({
                'id': 'roads-layer-line', 
                'type': 'line', 
                'source': 'roads-mvt-source', 
                'source-layer': 'roads', // 🎯 严格对齐 Go 后端的 'roads'
                'layout': { 
                    'line-join': 'round', 
                    'line-cap': 'round',
                    'visibility': 'visible'
                },
                'paint': {
                    'line-color': '#00FF88', // 强穿透超亮荧光绿
                    'line-width': [
                        'interpolate', ['linear'], ['zoom'], 
                        5, 2.0, 
                        10, 3.5, 
                        15, 6.0, 
                        18, 10.0
                    ],
                    'line-opacity': 0.95
                }
            });

            // ==========================================
            // 🔍 黑科技数据探针：直接打入内存级别断点
            // ==========================================
            this.map.on('sourcedata', (e) => {
                if (e.sourceId === 'roads-mvt-source' && e.isSourceLoaded) {
                    // 强行从当前视野网格中捞取被引擎解析出来的真实要素
                    const features = this.map.querySourceFeatures('roads-mvt-source', {
                        'sourceLayer': 'roads'
                    });
                    
                    console.log(`📡 [MVT 探针] 收到后端数据包，当前内存中解析出的线要素: ${features.length} 个`);
                    
                    if (features.length > 0) {
                        const sample = features[0];
                        console.log("📊 [数据透视] 成功捕获线数据！");
                        console.log(" -> 属性名称 (name):", sample.properties.name || "未命名");
                        console.log(" -> 道路等级 (highway):", sample.properties.highway);
                        console.log(" -> 几何类型 (Type):", sample.geometry.type);
                    }
                }
            });

            // 3. 业务图层：地理围栏 (MVT)
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

            // 4. 实时动态追踪层 (GeoJSON)
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