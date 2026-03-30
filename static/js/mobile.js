/**
 * Geo-Go Mobile Collector - 修正版
 */
const Collector = {
    watchId: null,
    id: null,

    init() {
        console.log("Collector 正在初始化...");
        this.id = this.getDeviceID();
        const deviceInfo = document.getElementById('device-info');
        if (deviceInfo) deviceInfo.innerText = `ID: ${this.id}`;
        this.setupUI();
    },

    getDeviceID() {
        let id = localStorage.getItem('geo_device_id');
        if (!id) {
            const ua = navigator.userAgent;
            const model = /iPhone/.test(ua) ? "iPhone" : "Android";
            const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
            id = `${model}_${suffix}`;
            localStorage.setItem('geo_device_id', id);
        }
        return id;
    },

    setupUI() {
        const btn = document.getElementById('mainBtn');
        if (!btn) {
            console.error("找不到 ID 为 mainBtn 的按钮！");
            return;
        }

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log("按钮点击触发，当前状态:", this.watchId ? "运行中" : "已停止");
            
            if (!this.watchId) {
                this.start();
            } else {
                this.stop();
            }
        });
    },

    start() {
        if (!navigator.geolocation) {
            alert("您的浏览器不支持地理定位");
            return;
        }

        document.body.classList.add('is-tracking');
        const statusTag = document.getElementById('status-tag');
        if (statusTag) statusTag.innerText = "LIVE BROADCASTING...";

        this.watchId = navigator.geolocation.watchPosition(pos => {
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;
            const provider = accuracy < 30 ? "gps" : "network";

            const coordsDiv = document.getElementById('coords');
            if (coordsDiv) {
                coordsDiv.innerText = `LAT: ${lat.toFixed(6)}\nLNG: ${lng.toFixed(6)}\nACC: ±${Math.round(accuracy)}m`;
            }

            // 这里的 URL 必须匹配你后端的 UpdateHandle 路由
            const url = `/update?id=${this.id}&lat=${lat}&lng=${lng}&provider=${provider}&accuracy=${accuracy}`;
            
            fetch(url).catch(err => console.error("上传失败:", err));

        }, err => {
            console.error("定位失败:", err);
            const coordsDiv = document.getElementById('coords');
            if (coordsDiv) coordsDiv.innerText = "LOCATION ERROR\nCHECK PERMISSIONS";
            this.stop();
        }, { 
            enableHighAccuracy: true, 
            maximumAge: 0, 
            timeout: 10000 
        });
    },

    stop() {
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        document.body.classList.remove('is-tracking');
        const coordsDiv = document.getElementById('coords');
        if (coordsDiv) coordsDiv.innerText = "PAUSED";
        const statusTag = document.getElementById('status-tag');
        if (statusTag) statusTag.innerText = "TAP TO START LIVE TRACKING";
    }
};

// 确保 DOM 加载完成后再初始化
document.addEventListener('DOMContentLoaded', () => {
    Collector.init();
});