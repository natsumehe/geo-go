/**
 * Geo-Go 指挥中心核心引擎 (MapLibre + PostGIS 原生全矢量咬合版)
 */
const App = {
    map: null,
    currentID: null,
    pollTimer: null,
    scrollTimeout: null,
    id: null,

    // 🎯 精准限定上海的地理外延边界，阻止用户拖拽到无数据盲区
    shanghaiBounds: [
        [121.10, 30.90], // 西南角: 青浦、松江南部边缘
        [121.75, 31.50]  // 东北角: 崇明南部、浦东机场外海边缘
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
        this.id = this.getDeviceID();
        const devInfo = document.getElementById('device-info');
        if (devInfo) devInfo.innerText = `DEVICE ID: ${this.id}`;
        
        this.initMap();
        this.startDiscovery();
        this.bindSwiper();
        console.log("Radar System Initialized.");
    },

    initMap() {
        // 🎯 核心修复：将地图实例赋给 App.map
        this.map = new maplibregl.Map({
            container: 'map',
            center: [121.4737, 31.2304],    // 初始中心点：上海市中心
            zoom: 13,                       
            minZoom: 10,                    // 适当放开到 10 级，保证能看清上海全貌
            maxZoom: 18,                    
            maxBounds: this.shanghaiBounds, 
            pitch: 45,                      // 倾斜视角
            // 🎯 核心修改：放弃无法吐出 MVT 的 Valhalla 底图，换用公网免费科技暗色标准底图，或者留空全黑背景
            style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
        });

        // 🎯 核心生命周期：严格在 load 回调中，使用 this.map 进行注入
        this.map.on('load', () => {
            console.log("基础底图渲染成功，开始注入 PostGIS 高性能原生业务图层...");
            
            const mvtHost = window.location.protocol + '//' + window.location.host;

            // 1. 🔗 注入地理围栏空间矢量瓦片源 (MVT)
            this.map.addSource('fences-mvt-source', {
                'type': 'vector',
                'tiles': [
                    mvtHost + '/tiles/fences/{z}/{x}/{y}.mvt'
                ],
                'minzoom': 0,
                'maxzoom': 22
            });

            // 🎨 渲染围栏多边形浅蓝色填充
            this.map.addLayer({
                'id': 'fences-layer-fill',
                'type': 'fill',
                'source': 'fences-mvt-source',
                'source-layer': 'fences', // 对应 Go 中 ST_AsMVT 的图层标识
                'paint': {
                    'fill-color': '#007cbf',
                    'fill-opacity': 0.18
                }
            });

            // 🎨 渲染围栏高亮物理边框
            this.map.addLayer({
                'id': 'fences-layer-outline',
                'type': 'line',
                'source': 'fences-mvt-source',
                'source-layer': 'fences',
                'paint': {
                    'line-color': '#00d2ff',
                    'line-width': 2
                }
            });

            // 2. 🔗 初始化动态设备轨迹数据源（供 draw 方法实时操作，避免频繁 rebuild）
            this.map.addSource('device-track', {
                'type': 'geojson',
                'data': { 'type': 'Feature', 'geometry': { 'type': 'LineString', 'coordinates': [] } }
            });
            this.map.addLayer({
                'id': 'track-layer', 'type': 'line', 'source': 'device-track',
                'layout': { 'line-join': 'round', 'line-cap': 'round' },
                'paint': { 'line-color': '#ffea00', 'line-width': 4 } // 亮黄色轨迹
            });

            this.map.addSource('device-pointer', {
                'type': 'geojson',
                'data': { 'type': 'Feature', 'geometry': { 'type': 'Point', 'coordinates': [0, 0] } }
            });
            this.map.addLayer({
                'id': 'pointer-layer', 'type': 'circle', 'source': 'device-pointer',
                'paint': { 'circle-radius': 7, 'circle-color': '#ff3333', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' }
            });

            // 💡 提示：原先混乱的 this.loadFences() 已被 MVT 完全平替，在此直接废弃
        });
    },

    // 自动发现活跃设备
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
            container.innerHTML = '<div class="swiper-slide">等待数据库同步...</div>';
            return;
        }
        container.innerHTML = validDevices.map(id => `
            <div class="swiper-slide ${id === this.currentID ? 'active' : ''}" data-id="${id}">
                <div class="slide-tag">已发现设备</div>
                <div class="slide-id">${id}</div>
                <div class="slide-status">● 数据库记录</div>
            </div>
        `).join('');

        if (!this.currentID && validDevices.length > 0) {
            this.selectDevice(validDevices[0]);
        }
    },

    bindSwiper() {
        const swiper = document.getElementById('device-swiper');
        if (!swiper) return;
        swiper.addEventListener('scroll', () => {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = setTimeout(() => this.handleScrollEnd(swiper), 150);
        });
    },

    handleScrollEnd(swiper) {
        const centerX = swiper.getBoundingClientRect().left + swiper.offsetWidth / 2;
        let closest = null;
        let minOffset = Infinity;
        document.querySelectorAll('.swiper-slide').forEach(slide => {
            const rect = slide.getBoundingClientRect();
            const offset = Math.abs(centerX - (rect.left + rect.width / 2));
            if (offset < minOffset) { minOffset = offset; closest = slide; }
        });
        if (closest) this.selectDevice(closest.getAttribute('data-id'));
    },

    selectDevice(id) {
        if (this.currentID === id) return;
        this.currentID = id;

        document.querySelectorAll('.swiper-slide').forEach(s => 
            s.classList.toggle('active', s.getAttribute('data-id') === id));

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

        // 🎯 核心修复：严格使用 this.map 保证对数据源的调用安全
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
    }
};

function toggleFullScreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
}

App.init();