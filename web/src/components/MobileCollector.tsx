import React from 'react';
import './MobileCollector.css';

interface MobileCollectorProps {
  deviceId: string;
  setDeviceId: (id: string) => void;
  isCollecting: boolean;
  startCollect: () => void;
  stopCollect: () => void;
  logs: string[];
  onSwitchToDashboard: () => void;
}

export const MobileCollector: React.FC<MobileCollectorProps> = ({
  deviceId,
  setDeviceId,
  isCollecting,
  startCollect,
  stopCollect,
  logs,
  onSwitchToDashboard,
}) => {
  return (
    <div className="mobile-container" style={{ width: '100vw', height: '100dvh', padding: '16px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: '#0F172A', color: '#FFF' }}>
      <h2 style={{ fontSize: '18px', margin: '0 0 16px 0' }}>📱 移动端空间坐标采集终端</h2>
      
      <div style={{ marginBottom: '8px' }}>
        <label>终端 ID:</label>
        <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={isCollecting} style={{ width: '100%', padding: '8px', background: '#1E293B', color: '#FFF', borderRadius: '6px' }} />
      </div>

      <button
        onClick={onSwitchToDashboard}
        style={{ width: '100%', padding: '10px', backgroundColor: '#059669', color: '#FFF', border: 'none', borderRadius: '6px', fontWeight: 'bold', marginBottom: '16px', cursor: 'pointer' }}
      >
        📊 切换至 显示大屏
      </button>

      <div style={{ marginBottom: '16px' }}>
        {!isCollecting ? (
          <button onClick={startCollect} style={{ width: '100%', padding: '12px', background: '#2563EB', color: '#FFF', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>开始定位上报</button>
        ) : (
          <button onClick={stopCollect} style={{ width: '100%', padding: '12px', background: '#DC2626', color: '#FFF', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>停止采集</button>
        )}
      </div>

      <div style={{ flex: 1, background: '#020617', padding: '12px', borderRadius: '6px', overflowY: 'auto' }}>
        <h4 style={{ margin: '0 0 8px 0', color: '#38BDF8' }}>📡 实时轨迹发送日志:</h4>
        {logs.map((log, i) => (
          <div key={i} style={{ fontSize: '12px', color: '#94A3B8', fontFamily: 'monospace', padding: '2px 0' }}>{log}</div>
        ))}
      </div>
    </div>
  );
};