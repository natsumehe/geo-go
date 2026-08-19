import { useState, useRef } from "react";
import * as maplibregl from 'maplibre-gl';
import { MapContainer } from './components/MapContainer';
import { LeftDevicePanel } from './components/LeftDevicePanel';
import { RightControlPanel } from './components/RightControlPanel';
import { MobileCollector } from './components/MobileCollector';
import { useGeoCollector } from './hooks/useGeoCollector';
import { useValhallaRouting } from './hooks/useValhallaRouting';
import { GodotContainer } from './components/GodotContainer';
import './App.css';

export function App() {
  const [viewMode, setViewMode] = useState<'dashboard' | 'collector' | 'game'>('dashboard');
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [deviceList, setDeviceList] = useState<string[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [collectedTracks, setCollectedTracks] = useState<Array<{ lng: number; lat: number }>>([]);

  const { deviceId, setDeviceId, isCollecting, logs, startCollect, stopCollect } = useGeoCollector();
  const { startCoordStr, endCoordStr, tripSummary, maneuvers, handleMapClick } = useValhallaRouting(mapRef);

  const switchDeviceHistory = async (id: string) => {
    setSelectedDevice(id);
    if (!id || !mapRef.current) return;
    try {
      const res = await fetch(`/history?id=${encodeURIComponent(id)}`);
      const geoJSON = await res.json();
      if (geoJSON.coordinates && geoJSON.coordinates.length > 0) {
        const formatted = geoJSON.coordinates.map((c: number[]) => ({ lng: c[0], lat: c[1] }));
        setCollectedTracks(formatted);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ width: '100vw', height: '100dvh', overflow: 'hidden', position: 'relative' }}>
      {/* 📊 大屏端地图视图 */}
      <div style={{ width: '100%', height: '100%', display: viewMode === 'dashboard' ? 'block' : 'none', position: 'relative' }}>
        <MapContainer 
          onMapClick={handleMapClick} 
          mapRef={mapRef} 
          setDeviceList={setDeviceList}
          collectedTracks={collectedTracks} 
          onOpenGame={() => setViewMode('game')}
        />
        <LeftDevicePanel
          deviceList={deviceList}
          selectedDevice={selectedDevice}
          switchDeviceHistory={switchDeviceHistory}
          collectedTracks={collectedTracks}
          onSwitchToCollector={() => setViewMode('collector')}
        />
        <RightControlPanel
          startCoordStr={startCoordStr}
          endCoordStr={endCoordStr}
          tripSummary={tripSummary}
          maneuvers={maneuvers}
        />
      </div>

      {/* 📱 移动端采集端视图 */}
      <div style={{ width: '100%', height: '100%', display: viewMode === 'collector' ? 'block' : 'none' }}>
        <MobileCollector
          deviceId={deviceId}
          setDeviceId={setDeviceId}
          isCollecting={isCollecting}
          startCollect={startCollect}
          stopCollect={stopCollect}
          logs={logs}
          onSwitchToDashboard={() => setViewMode('dashboard')}
        />
      </div>

      {/* 🎮 Godot 游戏沙盒全屏视图（带返回地图悬浮按钮） */}
      <div style={{ width: '100%', height: '100%', display: viewMode === 'game' ? 'block' : 'none', position: 'relative' }}>
        <button 
          onClick={() => setViewMode('dashboard')}
          style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            zIndex: 1000,
            padding: '10px 18px',
            backgroundColor: '#00FFCC',
            color: '#000',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '14px',
            boxShadow: '0 4px 15px rgba(0,255,204,0.4)',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#00ccb4'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#00FFCC'}
        >
          ⬅ 返回地图
        </button>
        <GodotContainer />
      </div>
    </div>
  );
}

export default App;