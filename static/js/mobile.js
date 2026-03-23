/**
 * Geo-Go Mobile Collector - 独立逻辑封装
 */
const Collector = {
    watchId: null,
    id: null,

    init() {
        this.id = this.getDeviceID();
        document.getElementById('device-info').innerText = `ID: ${this.id}`;
        this.setupUI();
    },

    getDeviceID() {
        let id = localStorage.getItem('geo_id');
        if (!id) {
            const model = /iPhone/.test(navigator.userAgent) ? "iPhone" : "Android";
            id = `${model}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
            localStorage.setItem('geo_id', id);
        }
        return id;
    },

    setupUI() {
        const btn = document.getElementById('mainBtn');
        btn.onclick = () => {
            if (!this.watchId) this.start();
            else this.stop();
        };
    },

    start() {
        document.body.classList.add('is-tracking');
        this.watchId = navigator.geolocation.watchPosition(pos => {
            const { latitude: lat, longitude: lng } = pos.coords;
            document.getElementById('coords').innerText = `LAT: ${lat.toFixed(6)}\nLNG: ${lng.toFixed(6)}`;
            fetch(`/update?id=${this.id}&lat=${lat}&lng=${lng}`);
        }, null, { enableHighAccuracy: true });
    },

    stop() {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
        document.body.classList.remove('is-tracking');
        document.getElementById('coords').innerText = "PAUSED";
    }
};

Collector.init();