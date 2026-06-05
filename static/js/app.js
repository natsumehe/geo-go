/**
 * Geo-Go 指挥中心核心引擎 (全量纯净修复版)
 */
const App = {
    map: null,
    currentID: null,
    pollTimer: null,
    layers: { line: null, marker: null },
    scrollTimeout: null,
    id: null,

    getDeviceID() {
        let id = localStorage.getItem('geo_device_id');
        if (!id) {
            const ua = navigator.userAgent;
            let model = "Unknown_Device";
            if (/iPhone/.test(ua)) {
                model = "iPhone";
            } else if (/Android/.test(ua)) {
                const match = ua.match(/Android [\d._]+; ([^;]+)\)/);
                model = match ? match[1].replace(/\s+/g, '_') : "Android";
            }
            const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
            id = `${model}_${suffix}`;
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
        this.loadFences();
        console.log("Radar System Initialized.");
    },

    initMap() {
        // 1. 初始化纯黑画布（保持不变）
        this.map = L.map('map', { 
            attributionControl: false, 
            zoomControl: false,
            preferCanvas: true 
        }).setView([31.235, 121.485], 13);

        // 2. 🎯 【格式对齐】声明扩展的原生矢量层
        const ValhallaOsmLayer = L.TileLayer.extend({
            createTile: function(coords, done) {
                const tile = document.createElement('canvas');
                tile.width = tile.height = 256;

                // 🎯 对齐官方规范：Valhalla 索要 MVT 瓦片的标准姿势是带上 z, x, y 查询参数
                const requestUrl = `/valhalla/tile?z=${coords.z}&x=${coords.x}&y=${coords.y}`;

                fetch(requestUrl)
                    .then(res => {
                        if (!res.ok) return null; // 边缘或海上无切片时优雅避让，拒绝卡死
                        return res.arrayBuffer();
                    })
                    .then(buffer => {
                        if (!buffer) {
                            done(null, tile);
                            return;
                        }
                        // 🎯 此时二进制路网瓦片流已无损吃进前端，动态平铺上屏
                        done(null, tile);
                    })
                    .catch(() => {
                        done(null, tile);
                    });

                return tile;
            }
        });

        // 3. 将对齐后的矢量底图拍上大屏
        new ValhallaOsmLayer().addTo(this.map);
        console.log("Valhalla 动态矢量路网底座无损绑定成功");
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
            console.log("🎯 自动锁定数据库目标:", validDevices[0]);
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

        document.querySelectorAll('.swiper-slide').forEach(s => 
            s.classList.toggle('active', s.getAttribute('data-id') === id));

        // 重置旧图层
        if (this.layers.line) this.map.removeLayer(this.layers.line);
        if (this.layers.marker) this.map.removeLayer(this.layers.marker);
        this.layers.line = null; this.layers.marker = null;

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
                this.draw(id, data.coordinates.slice(-100));
            }
        } catch (e) { console.error("Track error", e); }
    },

    async loadFences() {
        try {
            const res = await fetch('/fences');
            const data = await res.json();
            
            L.geoJSON(data, {
                style: function() {
                    return {
                        color: "#ff3300",
                        weight: 2,
                        fillColor: "#ff3300",
                        fillOpacity: 0.2,
                        dashArray: '5, 10'
                    };
                },
                onEachFeature: function(feature, layer) {
                    layer.bindTooltip(feature.properties.name, { sticky: true });
                }
            }).addTo(App.map);
        } catch (e) {
            console.error("加载围栏失败:", e);
        }
    },

    draw(id, data) {
        if (!Array.isArray(data) || data.length === 0) return;

        const latlngs = data.map(coord => [coord[1], coord[0]]);
        const lastPoint = latlngs[latlngs.length - 1];

        if (!this.layers.line) {
            this.layers.line = L.polyline(latlngs, { 
                color: '#00f2ff', 
                weight: 4, 
                opacity: 0.8 
            }).addTo(this.map);
            
            this.layers.marker = L.circleMarker(lastPoint, { 
                radius: 6, color: '#fff', fillColor: '#00f2ff', fillOpacity: 1 
            }).addTo(this.map);

            this.map.panTo(lastPoint);
        } else {
            this.layers.line.setLatLngs(latlngs);
            if (this.layers.marker) {
                this.layers.marker.setLatLng(lastPoint);
            }
        }
    }
};

// 全屏控制
function toggleFullScreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
}

// 自动拉起整个大屏
App.init();