import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './MapDashboard.css';

const SHANGHAI_BOUNDS: [[number, number], [number, number]] = [
  [120.85, 30.65],
  [122.15, 31.95],
];

interface MapContainerProps {
  onMapClick: (e: maplibregl.MapMouseEvent) => void;
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  setDeviceList: React.Dispatch<React.SetStateAction<string[]>>;
  collectedTracks: Array<{ lng: number; lat: number }>;
}

export const MapContainer: React.FC<MapContainerProps> = ({ 
  onMapClick, 
  mapRef, 
  setDeviceList, 
  collectedTracks 
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      attributionControl:false,
      container: mapContainerRef.current,
      center: [121.464799, 31.171322],
      zoom: 10,
      maxBounds: SHANGHAI_BOUNDS,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    });
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('roads-mvt-source', { type: 'vector', tiles: [`${window.location.origin}/tiles/roads/{z}/{x}/{y}.mvt`] });
      map.addSource('fences-mvt-source', { type: 'vector', tiles: [`${window.location.origin}/tiles/fences/{z}/{x}/{y}.mvt`] });

      map.addLayer({
        id: 'roads-layer-line',
        type: 'line',
        source: 'roads-mvt-source',
        'source-layer': 'roads',
        paint: {
          'line-color': [
            'match', ['get', 'highway'],
            'motorway', '#00FFCC', 
            'trunk', '#FF9500',    
            'primary', '#FFCC00',  
            '#3A3A3C'              
          ], 
          'line-width': [
            'match', ['get', 'highway'],
            'motorway', 6,
            'trunk', 4,
            'primary', 3,
            1.5
          ],
          'line-opacity': [
            'match', ['get', 'highway'],
            'motorway', 1.0, 
            0.55
          ]
        },
      });

      connectWebSocket();
    });

    map.on('click', onMapClick);

    const fetchList = async () => {
      try {
        const res = await fetch('/list');
        if (res.ok) {
          const list = await res.json();
          setDeviceList(list);
        }
      } catch (e) {}
    };
    fetchList();
    const intervalId = setInterval(fetchList, 5000);

    return () => {
      clearInterval(intervalId);
      if (wsRef.current) wsRef.current.close();
      map.remove();
    };
  }, []);

  const connectWebSocket = () => {
    const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'alarm') alert(`🚨 告警: ${data.driver}`);
      } catch (e) {}
    };
    ws.onclose = () => setTimeout(connectWebSocket, 5000);
  };

  
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !collectedTracks || collectedTracks.length === 0) return;

    const renderTrack = () => {
        const geojson = {
            type: 'Feature' as const,
            properties: {},
            geometry: { 
              type: 'LineString' as const, 
              coordinates: collectedTracks.map(c => [c.lng, c.lat]) 
            }
          };

      if (map.getLayer('device-track')) map.removeLayer('device-track');
      if (map.getSource('device-track-source')) map.removeSource('device-track-source');

      map.addSource('device-track-source', { type: 'geojson', data: geojson });
      map.addLayer({
        id: 'device-track',
        type: 'line',
        source: 'device-track-source',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: { 
          'line-color': '#007AFF', 
          'line-width': 5 
        }
      });

      // 自动平移并缩放到轨迹所在区域
      const coordinates = collectedTracks.map(c => [c.lng, c.lat] as [number, number]);
      if (coordinates.length > 0) {
        const bounds = coordinates.reduce(
          (b, coord) => b.extend(coord),
          new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
        );
        map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
      }
    };

    if (map.isStyleLoaded()) {
      renderTrack();
    } else {
      map.once('load', renderTrack);
    }
  }, [collectedTracks]);

  return <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />;
};