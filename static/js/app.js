/**
 * Geo-Go 指挥中心核心引擎 (MapLibre 高性能 WebGL 引擎解耦版)
 */
const App = {
    map: null,
    currentID: null,
    pollTimer: null,
    id: null,

    // 精准限定上海的地理外延边界，强制阻止用户拖拽到无数据盲区
    shanghaiBounds: [
        [121.10, 30.90], 
        [121.75, 31.50]  
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
            center: [121.4737, 31.2304],    
            zoom: 12,                       
            minZoom: 10,                    
            maxZoom: 18,                    
            maxBounds: this.shanghaiBounds, 
            pitch: 45,                      
            // 采用标准科技暗色调底图，完美烘托荧光绿物理路网与橙色轨迹
            style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
        });

        this.map.on('load', () => {
            console.log("WebGL 空间总线就绪，加载切片源...");
            document.getElementById('status').innerText = "底图及高性能路网就绪，正在追踪数据...";
            
            // 🎯 修复方案：动态适配当前环境的协议和端口。
            // 既然使用的是阿里云合规证书，瓦片通道必须走相同的 HTTPS 加密链路，防止浏览器拦截 Mixed Content。
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
            this.map.addSource('roads-mvt-source', {
                'type': 'vector',
                'tiles': [ mvtHost + '/tiles/roads/{z}/{x}/{y}.mvt' ]
            });
            this.map.addLayer({
                'id': 'roads-layer-line', 'type': 'line', 'source': 'roads-mvt-source', 'source-layer': 'roads',
                'layout': { 'line-join': 'round', 'line-cap': 'round' },
                'paint': {
                    'line-color': '#2ECC71', // 荧光绿物理路网
                    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.0, 15, 3.0, 18, 6.0],
                    'line-opacity': 0.65
                }
            }, 'fences-layer-outline'); // 放置于围栏下方，防重叠视差

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
        setInterval(refreshList, 5000); // 5秒轮询扫描新上线的设备
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
        this.pollTimer = setInterval(track, 3000); // 3秒强效死锁历史平滑链同步
    },

    async fetchUpdate(id) {
        try {
            const res = await fetch(`/history?id=${encodeURIComponent(id)}`);
            const data = await res.json();
            if (data.coordinates && data.coordinates.length > 0) {
                this.draw(data.coordinates.slice(-100)); // 取最新100个平滑点绘制，防止数据量过载闪烁
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