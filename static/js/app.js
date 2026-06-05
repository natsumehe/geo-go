/**
 * Geo-Go 指挥中心核心引擎 (MapLibre 高性能 WebGL 边界锁死版)
 */
const App = {
    map: null,
    currentID: null,
    pollTimer: null,
    scrollTimeout: null,
    id: null,

    // 🎯 精准限定上海的地理外延边界（西南角坐标 [lng, lat]，东北角坐标 [lng, lat]）
    // 强制阻止用户通过拖拽地图去窥探或触发无数据盲区的切片请求
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
        // 初始化 MapLibre WebGL 地图
        this.map = new maplibregl.Map({
            container: 'map',
            center: [121.4737, 31.2304],    // 初始中心点：上海市中心（延安东路附近）
            zoom: 13,                       // 默认初始化层级
            minZoom: 13,                    // 🚀 🔥【核心修改 1】锁死最小缩放！绝对不允许低于13级，从源头掐断低级别瓦片越界 400 报错
            maxZoom: 17,                    // 最大放大层级
            maxBounds: this.shanghaiBounds, // 🚀 🔥【核心修改 2】锁死物理推拽边界，拖不出上海范围
            pitch: 45,                      // 倾斜视角，更具指挥中心立体感
            style: {
                version: 8,
                sources: {
                    // 🎯 完美对接后端的 Valhalla 矢量切片
                    "valhalla-roads": {
                        type: "vector",
                        // 统一走标准的 restful 格式，后端的 Go 拦截器会自动动态洗成 Query 参数发给 Valhalla
                        tiles: [window.location.origin + "/valhalla/tile/{z}/{x}/{y}.mvt"],
                        minzoom: 13,        // 🚀 🔥【核心修改 3】数据源最小缩放对齐 13，不拉取低层级
                        maxzoom: 16         // 配合路网最高层级
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
                    },
                    // 🎯 【可选增强】为主干道/高速增加一层高亮渲染，视觉效果更好
                    {
                        "id": "major-roads-layer",
                        "type": "line",
                        "source": "valhalla-roads",
                        "source-layer": "roads",
                        "filter": ["in", "highway", "motorway", "trunk", "primary"],
                        "paint": {
                            "line-color": "#2a59a8",
                            "line-width": 2.5
                        }
                    }
                ]
            }
        });

        this.map.on('load', () => {
            console.log("Valhalla WebGL 动态矢量路网底座无损绑定成功");
            
            // 1. 添加地理围栏数据源
map.addSource('fences-mvt-source', {
    'type': 'vector',
    'tiles': [
        // 🎯 动态获取当前域名，直连你的 Go 统一接口
        window.location.protocol + '//' + window.location.host + '/tiles/fences/{z}/{x}/{y}.mvt'
    ],
    'minzoom': 0,
    'maxzoom': 22
});

// 2. 渲染围栏填充色
map.addLayer({
    'id': 'fences-layer-fill',
    'type': 'fill',
    'source': 'fences-mvt-source',
    'source-layer': 'fences', // 必须和 Go 中 ST_AsMVT(tilegeom.*, 'fences') 的名字完全对应
    'paint': {
        'fill-color': '#007cbf',
        'fill-opacity': 0.2
    }
});

// 3. 渲染围栏边界轮廓
map.addLayer({
    'id': 'fences-layer-outline',
    'type': 'line',
    'source': 'fences-mvt-source',
    'source-layer': 'fences',
    'paint': {
        'line-color': '#007cbf',
        'line-width': 2
    }
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