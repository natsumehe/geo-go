/**
 * Geo-Go App.js - 核心指挥控制逻辑 (多设备动态适配版)
 */

const CONFIG = {
    // 默认中心点 (上海)
    defaultCenter: [31.235, 121.485], 
    zoom: 14,
    api: {
        list: '/list',             // 获取 24h 内活跃设备
        history: '/history?id=',    // 获取指定设备轨迹
        alarms: '/alarms'          // 获取围栏告警
    }
};

// 全局状态管理
const STATE = {
    map: null,
    currentID: null,        // 当前选中的追踪目标
    layers: {
        trackLine: null,    // 轨迹线
        marker: null        // 实时位置点
    },
    lastAlarmKey: "",       // 用于告警去重
    pollTimer: null         // 轮询定时器
};

// 1. 程序入口
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initUI();
    startDevicePolling(); // 启动设备列表轮询
});

// 2. 初始化地图
function initMap() {
    STATE.map = L.map('map', { zoomControl: false }).setView(CONFIG.defaultCenter, CONFIG.zoom);
    
    // 使用 Dark Mode 底图，更有科技感
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CartoDB'
    }).addTo(STATE.map);

    L.control.zoom({ position: 'bottomleft' }).addTo(STATE.map);
}

// 3. UI 事件绑定
function initUI() {
    // 全屏切换逻辑已在 index.html 中实现，此处处理列表点击后的样式
    console.log("指挥中心 UI 已就绪");
}

// 4. 设备列表轮询 (自动发现新设备)
function startDevicePolling() {
    const refreshList = async () => {
        try {
            const res = await fetch(CONFIG.api.list);
            const devices = await res.json();
            renderDeviceList(devices);
        } catch (e) {
            console.error("设备列表刷新失败:", e);
        }
    };

    refreshList();
    setInterval(refreshList, 5000); // 每 5 秒搜寻一次新设备
    
    // 同时开启告警检测
    setInterval(checkAlarms, 3000);
}

// 5. 渲染侧边栏列表
function renderDeviceList(devices) {
    const listUl = document.getElementById('device-list');
    if (!listUl) return;

    listUl.innerHTML = '';
    if (devices.length === 0) {
        listUl.innerHTML = '<li style="color:#666">暂无活跃信号</li>';
        return;
    }

    devices.forEach(id => {
        const li = document.createElement('li');
        li.innerText = id;
        if (id === STATE.currentID) li.className = 'active';
        li.onclick = () => selectDevice(id);
        listUl.appendChild(li);
    });
}

// 6. 切换选中的设备
function selectDevice(id) {
    STATE.currentID = id;
    
    // 立即刷新列表高亮
    document.querySelectorAll('#device-list li').forEach(el => {
        el.classList.toggle('active', el.innerText === id);
    });

    // 重置地图元素
    if (STATE.layers.trackLine) STATE.map.removeLayer(STATE.layers.trackLine);
    if (STATE.layers.marker) STATE.map.removeLayer(STATE.layers.marker);
    STATE.layers.trackLine = null;
    STATE.layers.marker = null;

    // 启动追踪轮询
    if (STATE.pollTimer) clearInterval(STATE.pollTimer);
    const track = () => refreshTrack(id);
    track(); 
    STATE.pollTimer = setInterval(track, 2000);
}

// 7. 核心刷新函数：获取位置并绘图
async function refreshTrack(id) {
    try {
        const res = await fetch(CONFIG.api.history + encodeURIComponent(id));
        const geoJSON = await res.json();
        
        if (geoJSON && geoJSON.coordinates && geoJSON.coordinates.length > 0) {
            updateVisuals(id, geoJSON.coordinates);
        }
    } catch (e) {
        console.error(`追踪设备 ${id} 失败:`, e);
    }
}

// 8. 渲染地图上的动态元素
function updateVisuals(id, coords) {
    const latLngs = coords.map(c => [c[1], c[0]]);
    const currentPos = latLngs[latLngs.length - 1];

    // 绘制轨迹线
    if (!STATE.layers.trackLine) {
        STATE.layers.trackLine = L.polyline(latLngs, {
            color: '#00f2ff', 
            weight: 3, 
            opacity: 0.7, 
            dashArray: '5, 10' 
        }).addTo(STATE.map);
    } else {
        STATE.layers.trackLine.setLatLngs(latLngs);
    }

    // 绘制当前位置 Marker
    if (!STATE.layers.marker) {
        STATE.layers.marker = L.circleMarker(currentPos, {
            radius: 8, color: '#fff', fillColor: '#00f2ff', fillOpacity: 1, weight: 2
        }).addTo(STATE.map).bindPopup(`<b>正在追踪:</b> ${id}`).openPopup();
        
        STATE.map.panTo(currentPos); // 第一次发现时自动居中
    } else {
        STATE.layers.marker.setLatLng(currentPos);
        // 如果需要一直跟随，取消下面注释
        // STATE.map.panTo(currentPos); 
    }
}

// 9. 告警去重检测
async function checkAlarms() {
    try {
        const res = await fetch(CONFIG.api.alarms);
        const alarms = await res.json();
        
        if (alarms && alarms.length > 0) {
            const latest = alarms[0]; 
            const alarmKey = `${latest.time}-${latest.driver}`;

            if (alarmKey !== STATE.lastAlarmKey) {
                STATE.lastAlarmKey = alarmKey;
                pushAlarmUI(`${latest.driver} 闯入 ${latest.fence}`);
            }
        }
    } catch (e) {
        console.warn("告警检测暂不可用");
    }
}

function pushAlarmUI(msg) {
    const list = document.getElementById('alarm-list'); // 确保 HTML 中有此 ID
    if (!list) return;

    if (list.innerText.includes('暂无')) list.innerHTML = '';

    const div = document.createElement('div');
    div.className = 'alarm-item';
    div.style = "background: rgba(255,0,80,0.2); border-left: 4px solid #ff0050; padding: 10px; margin-bottom: 5px; font-size: 12px;";
    div.innerHTML = `<strong>⚠️ 告警:</strong> ${msg} <br><small>${new Date().toLocaleTimeString()}</small>`;
    list.prepend(div);
}