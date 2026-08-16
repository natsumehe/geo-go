import React from 'react';

interface RightControlPanelProps {
  startCoordStr: string;
  endCoordStr: string;
  tripSummary: { length: number; time: number } | null;
  maneuvers: Array<{ instruction: string; length: number; time: number }>;
}

export const RightControlPanel: React.FC<RightControlPanelProps> = ({
  startCoordStr,
  endCoordStr,
  tripSummary,
  maneuvers,
}) => {
  return (
    <div className="right-control-panel">
      <div className="panel-title">📍 坐标拾取</div>
      <input className="coord-input" readOnly value={startCoordStr} placeholder="点击地图拾取起点" />
      <input className="coord-input" readOnly value={endCoordStr} placeholder="点击地图拾取终点" />

      <div className="panel-title" style={{ marginTop: '20px' }}>🚗 Valhalla 导航路书</div>
      <div id="navigation-manifest-box">
        {tripSummary ? (
          <>
            <div style={{ background: 'rgba(0,255,204,0.1)', padding: '8px', borderRadius: '4px', marginBottom: '10px', borderLeft: '4px solid #00FFCC', color: '#FFF', fontSize: '12px' }}>
              🚗 <b>全长</b>: {tripSummary.length.toFixed(2)} km | <b>预计耗时</b>: {(tripSummary.time / 60).toFixed(1)} 分钟
            </div>
            <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
              {maneuvers.map((m, idx) => (
                <div key={idx} style={{ fontSize: '12px', padding: '6px 0', borderBottom: '1px solid #2C2C2E', color: '#FFF' }}>
                  <span style={{ color: '#FF2D55', fontWeight: 'bold' }}>{idx + 1}.</span> {m.instruction}
                </div>
              ))}
            </div>
          </>
        ) : (
          <span style={{ color: '#8E8E93', fontSize: '12px' }}>等待地图两点交互算路...</span>
        )}
      </div>
    </div>
  );
};