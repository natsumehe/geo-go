/**
 * Geo-Go Mobile Collector - 独立逻辑封装
 */
const Collector = {
    watchId: null,
    id: null,

    init() {
        // 建议统一使用一个 localStorage key，防止 index 和 mobile 识别成两个设备
        this.id = this.getDeviceID();
        document.getElementById('device-info').innerText = `ID: ${this.id}`;
        this.setupUI();
    },

    setupUI() {
    const btn = document.getElementById('mainBtn');
    if (!btn) {
        console.error("找不到 ID 为 mainBtn 的按钮！");
        return;
    }

    // 使用 addEventListener 替换直接赋值，确保可靠性
    btn.addEventListener('click', (e) => {
        e.preventDefault(); // 防止某些浏览器的默认行为
        console.log("按钮被点击，当前 watchId:", this.watchId);
        
        if (!this.watchId) {
            this.start();
        } else {
            this.stop();
        }
    });
}

    getDeviceID() {
        let id = localStorage.getItem('geo_device_id'); // 统一 Key
        if (!id) {
            const ua = navigator.userAgent;
            const model = /iPhone/.test(ua) ? "iPhone" : "Android";
            const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
            id = `${model}_${suffix}`;
            localStorage.setItem('geo_device_id', id);
        }
        return id;
    },

    start() {
        if (!navigator.geolocation) {
            alert("您的浏览器不支持地理定位");
            return;
        }

        document.body.classList.add('is-tracking');
        document.getElementById('status-tag').innerText = "LIVE BROADCASTING...";

        this.watchId = navigator.geolocation.watchPosition(pos => {
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;
            
            // 💡 核心逻辑：判定 Provider
            // 在 H5 环境中，通常精度 < 30m 认为是 GPS 信号，否则视为网络/基站定位
            const provider = accuracy < 30 ? "gps" : "network";

            // 更新 UI 显示
            document.getElementById('coords').innerText = 
                `LAT: ${lat.toFixed(6)}\nLNG: ${lng.toFixed(6)}\nACC: ±${Math.round(accuracy)}m`;

            // 🚀 发送给重构后的后端接口 (增加 provider 和 accuracy)
            const url = `/update?id=${this.id}&lat=${lat}&lng=${lng}&provider=${provider}&accuracy=${accuracy}`;
            
            fetch(url).catch(err => console.error("Upload failed", err));

        }, err => {
            console.error("Position Error:", err);
            document.getElementById('coords').innerText = "LOCATION ERROR\nCHECK PERMISSIONS";
        }, { 
            enableHighAccuracy: true, // 强制开启高精度模式（GPS）
            maximumAge: 0, 
            timeout: 10000 
        });
    },

    stop() {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
        document.body.classList.remove('is-tracking');
        document.getElementById('coords').innerText = "PAUSED";
    }
};

Collector.init();