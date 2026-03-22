/**
 * Geo-Go App.js - 核心控制逻辑 (增强版)
 */

const CONFIG = {
    targetID: "Tesla_Model_Y_001",
    // 自动切换到上海中心点以匹配你的数据库围栏
    center: [31.235, 121.485], 
    zoom: 14,
    api: {
        history: '/history?id=',
        nearby: '/nearby?lng=121.485&lat=31.235', // 记得同步附近的坐标
        alarms: '/alarms'
    }
};

let map, carMarker, trackLine;
let lastAlarmTime = ""; // 用于记录最后一条告警的时间，防止重复弹出

// 1. 程序入口
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initUI();
    startPolling();
});

function initMap() {
    map = L.map('map', { zoomControl: false }).setView(CONFIG.center, CONFIG.zoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CartoDB'
    }).addTo(map);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
}

function initUI() {
    const btn = document.getElementById('toggle-panel');
    const sidebar = document.getElementById('sidebar');
    btn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        setTimeout(() => map.invalidateSize(), 300);
    });
}

// 4. 定时轮询 (整合后的轮询函数)
function startPolling() {
    const tick = () => {
        refresh();
        checkNewAlarms();
    };
    tick(); // 立即执行一次
    setInterval(tick, 3000);
}

async function refresh() {
    try {
        // A. 更新在线人数
        const nRes = await fetch(CONFIG.api.nearby);
        const nData = await nRes.text();
        const count = (nData.match(/\d+/) || [0])[0];
        document.getElementById('count-online').innerText = count;

        // B. 更新轨迹
        const hRes = await fetch(CONFIG.api.history + CONFIG.targetID);
        const geoJSON = await hRes.json();
        if (geoJSON && geoJSON.coordinates) {
            updateVisuals(geoJSON.coordinates);
        }
    } catch (e) {
        console.error("轨迹刷新失败:", e);
    }
}

// 5. 渲染地图元素
function updateVisuals(coords) {
    if (coords.length === 0) return;
    const latLngs = coords.map(c => [c[1], c[0]]);
    const currentPos = latLngs[latLngs.length - 1];

    if (!trackLine) {
        trackLine = L.polyline(latLngs, { color: '#00f2ff', weight: 3, opacity: 0.6, dashArray: '5, 10' }).addTo(map);
    } else {
        trackLine.setLatLngs(latLngs);
    }

    if (!carMarker) {
        carMarker = L.circleMarker(currentPos, {
            radius: 10, color: '#fff', fillColor: '#00f2ff', fillOpacity: 1, weight: 3
        }).addTo(map);
        map.panTo(currentPos); 
    } else {
        carMarker.setLatLng(currentPos);
    }
}

// 核心改进：带去重逻辑的告警检测
async function checkNewAlarms() {
    try {
        const res = await fetch(CONFIG.api.alarms);
        const alarms = await res.json();
        
        if (alarms && alarms.length > 0) {
            // 只取最新的一条进行对比
            const latest = alarms[0]; 
            const alarmKey = `${latest.time}-${latest.driver}`;

            if (alarmKey !== lastAlarmTime) {
                lastAlarmTime = alarmKey;
                addAlarm(`${latest.driver} 闯入 ${latest.fence} (${latest.time})`);
            }
        }
    } catch (e) {
        console.error("告警接口异常:", e);
    }
}

function addAlarm(msg) {
    const list = document.getElementById('alarm-list');
    if (list.innerText.includes('暂无')) list.innerHTML = '';

    const div = document.createElement('div');
    div.className = 'alarm-item';
    div.innerHTML = `<strong>⚠️ 告警:</strong> ${msg} <br><small>${new Date().toLocaleTimeString()}</small>`;
    list.prepend(div);

    const countEl = document.getElementById('alarm-count') || document.getElementById('count-alarm');
    if (countEl) countEl.innerText = parseInt(countEl.innerText) + 1;
}