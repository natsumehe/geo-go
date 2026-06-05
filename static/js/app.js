/**
 * Geo-Go 指挥中心核心引擎 (MapLibre 高性能 WebGL 边界锁死修正版)
 */
const App = {
    map: null,
    currentID: null,
    pollTimer: null,
    scrollTimeout: null,
    id: null,

    // 精准限定上海的地理外延边界，强制阻止用户拖拽到无数据盲区
    shanghaiBounds: [
        [121.10, 30.90], 
        [121.75, 31.50]  
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
        // 🎯 修复 3：统一使用当前对象的 this.map，防止图层生命周期操作在未声明的全局变量上崩溃
        this.map = new maplibregl.Map({
            container: 'map',
            center: [121.4737, 31.2304],    
            zoom: 13,                       
            minZoom: 10,                    // 放宽最小层级，以便看清边界
            maxZoom: 17,                    
            maxBounds: this.shanghaiBounds, 
            pitch: 45,                      
            // 🎯 修复 4：放弃失效的本地 Valhalla 切片作为底色，改用标准公网科技暗色调底图
            style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
        });

        this.map.on('load', () => {
            console.log("基础底座及样式加载成功，开始注入业务图层...");
            
            const mvtHost = window.location.protocol + '//' + window.location.host;

            // 1. 添加地理围栏数据源 (MVT)
            this.map.addSource('fences-mvt-source', {
                'type': 'vector',
                'tiles': [
                    mvtHost + '/tiles/fences/{z}/{x}/{y}.mvt'
                ],
                'minzoom': 0,
                'maxzoom': 22
            });

            // 2. 渲染围栏填充色
            this.map.addLayer({
                'id': 'fences-layer-fill',
                'type': 'fill',
                'source': 'fences-mvt-source',
                'source-layer': 'fences', 
                'paint': {
                    'fill-color': '#007cbf',
                    'fill-opacity': 0.18
                }
            });

            // 3. 渲染围栏边界轮廓
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

            // 4. 初始化动态轨迹点与线数据源，防止 draw 实时重置时缺失
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

            // 💡 提示：原先冲突的旧接口 this.loadFences() 已被 MVT 完美平替，在此安全移除
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

        // 🎯 修复 5：严格基于 this.map 完成 WebGL 动态渲染数据更新
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