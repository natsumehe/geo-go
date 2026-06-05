/**
 * Geo-Go 指挥中心核心引擎 (MapLibre 高性能 WebGL 版)
 */
const App = {
    map: null,
    currentID: null,
    pollTimer: null,
    scrollTimeout: null,
    id: null,

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
        // 围栏加载移入地图 load 事件中
        console.log("Radar System Initialized.");
    },

    initMap() {
        // 初始化 MapLibre WebGL 地图
        this.map = new maplibregl.Map({
            container: 'map',
            center: [121.4737, 31.2304],
            zoom: 13,
            pitch: 45, // 倾斜视角，更具指挥中心立体感
            style: {
                version: 8,
                sources: {
                    // 🎯 完美对接后端的 Valhalla 矢量切片
                    "valhalla-roads": {
                        type: "vector",
                        tiles: [window.location.origin + "/valhalla/tile/{z}/{x}/{y}.mvt"],
                        minzoom: 0,
                        maxzoom: 16
                    }
                },
                layers: [
                    {
                        "id": "background",
                        "type": "background",
                        "paint": { "background-color": "#0b0f19" } // 指挥中心科技暗色调
                    },
                    {
                        "id": "roads-layer",
                        "type": "line",
                        "source": "valhalla-roads",
                        "source-layer": "roads", // 对应 Valhalla 切片内部的图层名称
                        "paint": {
                            "line-color": "#1f293d",
                            "line-width": 1.2
                        }
                    }
                ]
            }
        });

        this.map.on('load', () => {
            console.log("Valhalla WebGL 动态矢量路网底座无损绑定成功");
            
            // 初始化轨迹动态数据源
            this.map.addSource('device-track', {
                type: 'geojson',
                data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
            });
            this.map.addLayer({
                id: 'track-line', type: 'line', source: 'device-track',
                paint: { 'line-color': '#00f2ff', 'line-width': 4, 'line-opacity': 0.8 }
            });

            this.map.addSource('device-pointer', {
                type: 'geojson',
                data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0,0] } }
            });
            this.map.addLayer({
                id: 'track-point', type: 'circle', source: 'device-pointer',
                paint: { 'circle-radius': 6, 'circle-color': '#00f2ff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 }
            });

            this.loadFences();
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

    async loadFences() {
        try {
            const res = await fetch('/fences');
            const data = await res.json();
            
            this.map.addSource('fences-src', { type: 'geojson', data: data });
            this.map.addLayer({
                id: 'fences-layer', type: 'fill', source: 'fences-src',
                paint: { 'fill-color': '#ff3300', 'fill-opacity': 0.15 }
            });
            this.map.addLayer({
                id: 'fences-outline', type: 'line', source: 'fences-src',
                paint: { 'line-color': '#ff3300', 'line-width': 2, 'line-dasharray': [2, 4] }
            });
        } catch (e) { console.error("加载围栏失败:", e); }
    },

    draw(coordinates) {
        if (!coordinates || coordinates.length === 0) return;
        const lastPoint = coordinates[coordinates.length - 1];

        // WebGL 动态更新数据源，不损耗内存
        if (this.map.getSource('device-track')) {
            this.map.getSource('device-track').setData({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coordinates }
            });
        }
        if (this.map.getSource('device-pointer')) {
            this.map.getSource('device-pointer').setData({
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