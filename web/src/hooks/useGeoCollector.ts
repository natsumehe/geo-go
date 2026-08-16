import { useState, useEffect } from 'react';

export function useGeoCollector() {
  const [deviceId, setDeviceId] = useState('DEV_01');
  const [isCollecting, setIsCollecting] = useState(false);
  const [logs, setLogs] = useState<string[]>(['系统就绪：等待开始采集位置上报...']);

  useEffect(() => {
    let timer: any;
    if (isCollecting) {
      timer = setInterval(() => {
        const mockLng = 121.234 + Math.random() * 0.01;
        const mockLat = 31.415 + Math.random() * 0.01;
        const timeStr = new Date().toLocaleTimeString();
        setLogs((prev) => [
          `[${timeStr}] 终端 [${deviceId}] 上报 -> 经: ${mockLng.toFixed(5)}, 纬: ${mockLat.toFixed(5)}`,
          ...prev,
        ]);
      }, 3000);
    }
    return () => clearInterval(timer);
  }, [isCollecting, deviceId]);

  const startCollect = () => {
    if (!deviceId.trim()) {
      alert('请先输入终端 ID');
      return;
    }
    setIsCollecting(true);
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] 🚀 开始位置上报...`, ...prev]);
  };

  const stopCollect = () => {
    setIsCollecting(false);
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ⏹️ 停止位置上报。`, ...prev]);
  };

  return { deviceId, setDeviceId, isCollecting, logs, startCollect, stopCollect };
}