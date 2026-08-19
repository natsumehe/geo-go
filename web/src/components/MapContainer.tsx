import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './MapDashboard.css';

import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// ============================================================
// MapLibre GL JS v6 + Vite
// ============================================================
maplibregl.setWorkerUrl(workerUrl);

console.log('========================================');
console.log('MapLibre Worker URL:', workerUrl);
console.log('========================================');

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
}

export const MapContainer: React.FC<MapContainerProps> = ({
  onMapClick,
  mapRef,
  setDeviceList,
  collectedTracks,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) {
      console.error('❌ mapContainerRef.current 不存在');
      return;
    }

    console.log('========================================');
    console.log('🗺️ 开始创建 MapLibre Map');
    console.log('========================================');

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

    // ========================================================
    // 保存 Map
    // ========================================================
    mapRef.current = map;
    (window as any).__MAPLIBRE_MAP__ = map;

    console.log('✅ new Map');
    console.log('Map instance:', map);
    console.log('Map container:', mapContainerRef.current);
    console.log('Initial center:', map.getCenter());
    console.log('Initial zoom:', map.getZoom());
    console.log('DevicePixelRatio:', window.devicePixelRatio);

    // ========================================================
    // MapLibre ERROR
    // ========================================================
    map.on('error', (event) => {
      console.error('❌❌❌ MapLibre ERROR:', event);
      if (event?.error) {
        const errObj = event.error as any;
        console.error('Error object:', errObj);
        console.error('Error message:', errObj.message);
        console.error('Error stack:', errObj.stack || 'No stack available');
      }
    });

    // ========================================================
    // style loading / data / sources
    // ========================================================
    map.on('styledataloading', () => {
      console.log('🎨 styledataloading');
    });

    map.on('styledata', () => {
      console.log('🎨 styledata event');
      try {
        const style = map.getStyle();
        console.log('Style name:', style?.name);
        console.log('Style sources:', Object.keys(style?.sources || {}));
        console.log('Style layers:', style?.layers?.map((layer) => layer.id));
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error('读取 style 失败:', err.message);
      }
    });

    map.on('sourcedataloading', (event) => {
      console.log('📥 sourcedataloading:', event.sourceId, event.sourceDataType);
    });

    map.on('sourcedata', (event) => {
      console.log(
        '📦 sourcedata:',
        event.sourceId,
        event.sourceDataType,
        'isSourceLoaded:',
        event.isSourceLoaded
      );
    });

    map.on('webglcontextlost', () => {
      console.error('❌ WebGL context lost');
    });

    map.on('webglcontextrestored', () => {
      console.log('✅ WebGL context restored');
    });

    // ========================================================
    // 自定义 source / layer 初始化函数
    // ========================================================
    const initializeCustomLayers = () => {
      console.log('========================================');
      console.log('🚀 初始化自定义地图图层');
      console.log('========================================');

      if (!map.isStyleLoaded()) {
        console.warn('⚠️ style 尚未 ready');
        return;
      }

      // 1. roads source & layer
      if (!map.getSource('roads-mvt-source')) {
        const roadsUrl = `${window.location.origin}/tiles/roads/{z}/{x}/{y}.mvt`;
        console.log('🔥 addSource roads:', roadsUrl);
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
        console.log('🔥 addSource fences:', fencesUrl);
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
        console.log('🔥 addSource devices:', devicesUrl);
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

      console.log('✅ 自定义图层初始化完成');
    };

    // ========================================================
    // MAP LOAD
    // ========================================================
    map.once('load', () => {
      console.log('🔥🔥🔥 MAP LOAD FIRED');
      console.log('loaded:', map.loaded());
      console.log('styleLoaded:', map.isStyleLoaded());
      console.log('tilesLoaded:', map.areTilesLoaded());

      initializeCustomLayers();
    });

    map.on('idle', () => {
      // 避免控制台刷屏，这里保留状态，如有需要可取消注释
      // console.log('💤 MAP IDLE');
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
      console.log('🧹 MapContainer cleanup');
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
