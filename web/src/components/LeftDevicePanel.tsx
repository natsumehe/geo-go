import React from 'react';

interface LeftDevicePanelProps {
  deviceList: string[];
  selectedDevice: string;
  switchDeviceHistory: (id: string) => void;
  collectedTracks: Array<{ lng: number; lat: number }>;
  onSwitchToCollector: () => void;
}

export const LeftDevicePanel: React.FC<LeftDevicePanelProps> = ({
  deviceList,
  selectedDevice,
  switchDeviceHistory,
  collectedTracks,
  onSwitchToCollector,
}) => {
  return (
    <div className="left-panel">
      <h3 style={{ color: '#00FFCC', margin: '0 0 10px 0', fontSize: '15px' }}>🛰️ 活跃终端选择</h3>
      <select
        className="device-select"
        value={selectedDevice}
        onChange={(e) => switchDeviceHistory(e.target.value)}
        style={{ width: '100%', padding: '8px', background: '#1E293B', color: '#FFF', borderRadius: '6px' }}
      >
        <option value="">-- 选择设备查看历史轨迹 --</option>
        {deviceList.map((id) => (
          <option key={id} value={id}>设备 ID: {id}</option>
        ))}
      </select>

      {/* 实时采集流展示 */}
      <div id="collected-tracks-box" style={{ marginTop: '10px' }}>
        {selectedDevice ? (
          <>
            <div style={{ color: '#FFD60A', marginBottom: '6px', fontSize: '12px' }}>
              🛰️ 设备 [{selectedDevice}] 实时采集流:
            </div>
            <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
              {collectedTracks.map((pt, i) => (
                <div key={i} style={{ fontSize: '11px', borderBottom: '1px dashed #2C2C2E', padding: '3px 0', color: '#FFF' }}>
                  <span style={{ color: '#8E8E93' }}>[#{i}]</span> 经: {pt.lng.toFixed(5)} | 纬: {pt.lat.toFixed(5)}
                </div>
              ))}
            </div>
          </>
        ) : (
          <span style={{ color: '#8E8E93', fontSize: '11px' }}>请先选择设备查看采集流...</span>
        )}
      </div>

      {/* 切换至采集端按钮 */}
      <button
        onClick={onSwitchToCollector}
        style={{
          marginTop: '12px',
          width: '100%',
          padding: '10px',
          backgroundColor: '#007AFF',
          color: '#FFF',
          border: 'none',
          borderRadius: '6px',
          fontWeight: 'bold',
          cursor: 'pointer',
        }}
      >
        🔄 切换至 空间坐标采集端
      </button>
    </div>
  );
};