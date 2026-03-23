/**
 * Geo-Go 指挥中心核心引擎
 */
const App = {
    map: null,
    currentID: null,
    pollTimer: null,
    layers: { line: null, marker: null },
    scrollTimeout: null,
    id: null,

    getDeviceID() {
        // 1. 先尝试从本地存储读取（这是保证“老用户”不变成“新设备”的关键）
        let id = localStorage.getItem('geo_device_id');
        
        if (!id) {
            // 2. 如果是第一次进入，获取设备信息
            const ua = navigator.userAgent;
            let model = "Unknown_Device";
            
            // 提取型号：例如从 "iPhone; CPU iPhone OS 17_4" 中提取 iPhone
            if (/iPhone/.test(ua)) {
                model = "iPhone";
            } else if (/Android/.test(ua)) {
                const match = ua.match(/Android [\d._]+; ([^;]+)\)/);
                model = match ? match[1].replace(/\s+/g, '_') : "Android";
            }

            // 3. 生成一个 4 位随机后缀（仅在第一次生成，后续永远不变）
            const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
            id = `${model}_${suffix}`;

            // 4. 关键：存入 localStorage，只要用户不清除浏览器缓存，它就永远是这个 ID
            localStorage.setItem('geo_device_id', id);
        }
        return id;
    },
    init() {
        this.id = this.getDeviceID();
        document.getElementById('device-info').innerText = `DEVICE ID: ${this.id}`;
        this.initMap();
        this.startDiscovery();
        this.bindSwiper();
        console.log("Radar System Initialized.");
    },

    initMap() {
        // 去除标志并开启 Canvas 渲染提高性能
        this.map = L.map('map', { 
            attributionControl: false, 
            zoomControl: false,
            renderer: L.canvas() 
        }).setView([31.235, 121.485], 14);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(this.map);
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
        if (!container || devices.length === 0) return;

        // 保存当前滚动位置防止刷新时跳动
        container.innerHTML = devices.map(id => `
            <div class="swiper-slide ${id === this.currentID ? 'active' : ''}" data-id="${id}">
                <div class="slide-tag">ACTIVE DEVICE</div>
                <div class="slide-id">${id}</div>
                <div class="slide-status">● ONLINE</div>
            </div>
        `).join('');
    },

    bindSwiper() {
        const swiper = document.getElementById('device-swiper');
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
            if (offset < minOffset) {
                minOffset = offset;
                closest = slide;
            }
        });

        if (closest) {
            const id = closest.getAttribute('data-id');
            this.selectDevice(id);
        }
    },

    selectDevice(id) {
        if (this.currentID === id) return;
        this.currentID = id;

        // UI 状态切换
        document.querySelectorAll('.swiper-slide').forEach(s => 
            s.classList.toggle('active', s.getAttribute('data-id') === id));

        // 重置地图层
        if (this.layers.line) this.map.removeLayer(this.layers.line);
        if (this.layers.marker) this.map.removeLayer(this.layers.marker);
        this.layers.line = null; this.layers.marker = null;

        // 开启追踪
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
                this.draw(id, data.coordinates.slice(-100)); // 只取最近100个点防止卡顿
            }
        } catch (e) { console.error("Track error", e); }
    },

    draw(id, coords) {
        const latlngs = coords.map(c => [c[1], c[0]]);
        const last = latlngs[latlngs.length - 1];

        if (!this.layers.line) {
            this.layers.line = L.polyline(latlngs, { color: '#00f2ff', weight: 4, opacity: 0.6 }).addTo(this.map);
            this.layers.marker = L.circleMarker(last, { radius: 8, color: '#fff', fillColor: '#00f2ff', fillOpacity: 1 }).addTo(this.map);
            this.map.panTo(last);
        } else {
            this.layers.line.setLatLngs(latlngs);
            this.layers.marker.setLatLng(last);
        }
    }
};

// 全屏控制
function toggleFullScreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
}

App.init();