import React, { useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { MapContainer } from './components/MapContainer';
import { LeftDevicePanel } from './components/LeftDevicePanel';
import { RightControlPanel } from './components/RightControlPanel';
import { MobileCollector } from './components/MobileCollector';
import { useGeoCollector } from './hooks/useGeoCollector';
import { useValhallaRouting } from './hooks/useValhallaRouting';
import './App.css';

export function App() {
  const [viewMode, setViewMode] = useState<'dashboard' | 'collector'>('dashboard');
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
        
        if ((mapRef.current as any).renderTrackLine) {
          (mapRef.current as any).renderTrackLine(formatted);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ width: '100vw', height: '100dvh', overflow: 'hidden', position: 'relative' }}>
      {/* 📊 大屏端 (用 display 控制显隐，保证切回来时底图不销毁不闪烁) */}
      <div style={{ width: '100%', height: '100%', display: viewMode === 'dashboard' ? 'block' : 'none', position: 'relative' }}>
        <MapContainer 
          onMapClick={handleMapClick} 
          mapRef={mapRef} 
          setDeviceList={setDeviceList}
          collectedTracks={collectedTracks} 
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

      {/* 📱 移动端采集端 */}
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
    </div>
  );
}

export default App;