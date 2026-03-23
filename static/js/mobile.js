/**
 * Geo-Go Mobile Tracker Engine
 * 自动识别设备并无感上报位置
 */

const Tracker = {
    watchId: null,
    deviceID: '',

    // 1. 初始化入口
    init() {
        this.deviceID = this.getOrCreateID();
        document.getElementById('device-info').innerText = `ID: ${this.deviceID}`;
        this.bindEvents();
    },

    // 2. 自动生成并存储设备 ID (无感识别)
    getOrCreateID() {
        let id = localStorage.getItem('geo_device_id');
        if (!id) {
            const ua = navigator.userAgent;
            let model = "Device";
            
            if (/iPhone/.test(ua)) model = "iPhone";
            else if (/Android/.test(ua)) {
                const match = ua.match(/Android [\d._]+; ([^;]+)\)/);
                model = match ? match[1].replace(/\s+/g, '_') : "Android";
            }
            
            const random = Math.random().toString(36).substring(2, 6).toUpperCase();
            id = `${model}_${random}`;
            localStorage.setItem('geo_device_id', id);
        }
        return id;
    },

    // 3. 绑定点击事件
    bindEvents() {
        const btn = document.getElementById('mainBtn');
        btn.addEventListener('click', () => {
            if (!this.watchId) {
                this.start();
            } else {
                this.stop();
            }
        });
    },

    // 4. 开启追踪
    start() {
        if (!navigator.geolocation) {
            alert("您的设备不支持 GPS 定位");
            return;
        }

        document.body.classList.add('is-tracking');
        document.getElementById('status-tag').innerText = "LIVE RECORDING...";

        this.watchId = navigator.geolocation.watchPosition(
            (pos) => this.handleLocation(pos),
            (err) => this.handleError(err),
            {
                enableHighAccuracy: true, // 核心：开启高精度 GPS
                maximumAge: 0,
                timeout: 10000
            }
        );
    },

    // 5. 停止追踪
    stop() {
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        document.body.classList.remove('is-tracking');
        document.getElementById('status-tag').innerText = "TRACKING STOPPED";
        document.getElementById('coords').innerText = "READY TO SCAN";
    },

    // 6. 处理位置更新并上报
    handleLocation(pos) {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        
        // 更新 UI
        document.getElementById('coords').innerText = 
            `LAT: ${lat.toFixed(6)}\nLNG: ${lng.toFixed(6)}\nACC: ±${Math.round(accuracy)}m`;

        // 发送到 Go 后端
        const url = `/update?id=${encodeURIComponent(this.deviceID)}&lat=${lat}&lng=${lng}`;
        fetch(url).catch(err => console.error("上报失败", err));
    },

    handleError(err) {
        let msg = "定位失败";
        if (err.code === 1) msg = "请允许 GPS 权限";
        else if (err.code === 3) msg = "定位超时，请到开阔地带";
        document.getElementById('coords').innerText = `ERROR: ${msg}`;
        this.stop();
    }
};

// 启动引擎
Tracker.init();