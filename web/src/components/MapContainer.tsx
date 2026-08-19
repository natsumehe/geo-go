import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './MapDashboard.css';

import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// ============================================================
// MapLibre GL JS v6 + Vite
// ============================================================
maplibregl.setWorkerUrl(workerUrl);

const SHANGHAI_BOUNDS: [[number, number], [number, number]] = [
  [120.85, 30.65],
  [122.15, 31.95],
];

interface MapContainerProps {
  onMapClick: (e: maplibregl.MapMouseEvent) => void;
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  setDeviceList: React.Dispatch<React.SetStateAction<string[]>>;
  collectedTracks: Array<{
    lng: number;
    lat: number;
  }>;
  onOpenGame: () => void; // 用于触发跳转到游戏界面
}

export const MapContainer: React.FC<MapContainerProps> = ({
  onMapClick,
  mapRef,
  setDeviceList,
  collectedTracks,
  onOpenGame,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) {
      console.error('❌ mapContainerRef.current 不存在');
      return;
    }

    // ========================================================
    // 创建 Map
    // ========================================================
    const map = new maplibregl.Map({
      attributionControl: false,
      container: mapContainerRef.current,
      center: [121.464799, 31.171322],
      zoom: 11,
      maxBounds: SHANGHAI_BOUNDS,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    });

    mapRef.current = map;
    (window as any).__MAPLIBRE_MAP__ = map;

    // ========================================================
    // MapLibre ERROR
    // ========================================================
    map.on('error', (event) => {
      console.error('❌❌❌ MapLibre ERROR:', event);
    });

    // ========================================================
    // 自定义 source / layer 初始化函数
    // ========================================================
    const initializeCustomLayers = () => {
      if (!map.isStyleLoaded()) return;

      // 1. roads source & layer
      if (!map.getSource('roads-mvt-source')) {
        const roadsUrl = `${window.location.origin}/tiles/roads/{z}/{x}/{y}.mvt`;
        map.addSource('roads-mvt-source', {
          type: 'vector',
          tiles: [roadsUrl],
          minzoom: 0,
          maxzoom: 22,
        });
      }

      // 2. fences source & layer
      if (!map.getSource('fences-mvt-source')) {
        const fencesUrl = `${window.location.origin}/tiles/fences/{z}/{x}/{y}.mvt`;
        map.addSource('fences-mvt-source', {
          type: 'vector',
          tiles: [fencesUrl],
          minzoom: 0,
          maxzoom: 22,
        });
      }

      // 3. devices source & layer
      if (!map.getSource('devices-mvt-source')) {
        const devicesUrl = `${window.location.origin}/tiles/devices/{z}/{x}/{y}.mvt`;
        map.addSource('devices-mvt-source', {
          type: 'vector',
          tiles: [devicesUrl],
          minzoom: 0,
          maxzoom: 22,
        });
      }

      const layers = map.getStyle().layers || [];
      let firstSymbolId: string | undefined;
      for (const layer of layers) {
        if (layer.type === 'symbol') {
          firstSymbolId = layer.id;
          break;
        }
      }

      // 添加 roads 线图层
      if (!map.getLayer('roads-layer-line')) {
        map.addLayer(
          {
            id: 'roads-layer-line',
            type: 'line',
            source: 'roads-mvt-source',
            'source-layer': 'roads',
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': [
                'match',
                ['get', 'highway'],
                'motorway', '#00FFCC',
                'trunk', '#FF9500',
                'primary', '#FFCC00',
                '#3A3A3C',
              ],
              'line-width': [
                'match',
                ['get', 'highway'],
                'motorway', 6,
                'trunk', 4,
                'primary', 3,
                1.5,
              ],
              'line-opacity': 0.85,
            },
          },
          firstSymbolId
        );
      }

      // 添加 devices 点图层
      if (!map.getLayer('devices-layer-point')) {
        map.addLayer({
          id: 'devices-layer-point',
          type: 'circle',
          source: 'devices-mvt-source',
          'source-layer': 'devices',
          paint: {
            'circle-color': '#FF3B30',
            'circle-radius': 6,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
          },
        });
      }
    };

    // ========================================================
    // MAP LOAD
    // ========================================================
    map.once('load', () => {
      initializeCustomLayers();

      // ========================================================
      // 📍 在地图上创建带图片的自定义游戏入口标签
      // ========================================================
      const el = document.createElement('div');
      el.className = 'game-map-marker';
      el.style.cssText = `
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        background: rgba(20, 20, 20, 0.85);
        padding: 8px 12px;
        border-radius: 10px;
        border: 1px solid #00FFCC;
        box-shadow: 0 4px 15px rgba(0,255,204,0.4);
        transition: transform 0.2s ease;
      `;
      
      // 内部放入图片与文字
      el.innerHTML = `
        <img src="/image-1.svg" alt="Game Entry" style="width: 36px; height: 36px; margin-bottom: 4px; object-fit: contain;" />
        <span style="color: #00FFCC; font-size: 12px; font-weight: bold; white-space: nowrap;">进入游戏WASD控制</span>
      `;
      
      // 点击标签触发切换到游戏界面
      el.addEventListener('click', () => {
        onOpenGame();
      });

      // 在地图指定坐标（例如上海市中心附近）添加 Marker
      new maplibregl.Marker({ element: el })
        .setLngLat([121.4737, 31.2304])
        .addTo(map);
    });

    map.on('click', onMapClick);

    // ========================================================
    // 定时获取设备列表
    // ========================================================
    const fetchList = async () => {
      try {
        const res = await fetch('/list');
        if (res.ok) {
          const list = await res.json();
          setDeviceList(list);
        }
      } catch (e) {
        console.error('❌ /list request error:', e);
      }
    };

    fetchList();
    const intervalId = setInterval(fetchList, 5000);

    // ========================================================
    // cleanup
    // ========================================================
    return () => {
      clearInterval(intervalId);
      map.off('click', onMapClick);

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      if ((window as any).__MAPLIBRE_MAP__ === map) {
        delete (window as any).__MAPLIBRE_MAP__;
      }

      if (mapRef.current === map) {
        mapRef.current = null;
      }

      map.remove();
    };
  }, []);

  // ==============================================================
  // collectedTracks → GeoJSON LineString (轨迹渲染)
  // ==============================================================
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !collectedTracks || collectedTracks.length === 0) {
      return;
    }

    const renderTrack = () => {
      try {
        const geojson = {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: collectedTracks.map((c) => [c.lng, c.lat]),
          },
        };

        if (map.getLayer('device-track')) {
          map.removeLayer('device-track');
        }
        if (map.getSource('device-track-source')) {
          map.removeSource('device-track-source');
        }

        map.addSource('device-track-source', {
          type: 'geojson',
          data: geojson,
        });

        map.addLayer({
          id: 'device-track',
          type: 'line',
          source: 'device-track-source',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#007AFF',
            'line-width': 5,
          },
        });

        const coordinates = collectedTracks.map((c) => [c.lng, c.lat] as [number, number]);
        if (coordinates.length > 0) {
          const bounds = coordinates.reduce(
            (b, coord) => b.extend(coord),
            new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
          );
          map.fitBounds(bounds, {
            padding: 60,
            maxZoom: 15,
          });
        }
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error('❌ 渲染轨迹失败:', err.message);
      }
    };

    if (map.isStyleLoaded()) {
      renderTrack();
    } else {
      map.once('load', renderTrack);
    }
  }, [collectedTracks]);

  return (
    <div
      ref={mapContainerRef}
      style={{
        width: '100%',
        height: '100%',
      }}
    />
  );
};