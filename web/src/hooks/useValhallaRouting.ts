import { useState, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';

export function useValhallaRouting(mapRef: React.RefObject<maplibregl.Map | null>) {
  const [startCoordStr, setStartCoordStr] = useState<string>('');
  const [endCoordStr, setEndCoordStr] = useState<string>('');
  const [tripSummary, setTripSummary] = useState<{ length: number; time: number } | null>(null);
  const [maneuvers, setManeuvers] = useState<Array<{ instruction: string; length: number; time: number }>>([]);

  const routingPointsRef = useRef<number[][]>([]);
  const routeMarkersRef = useRef<maplibregl.Marker[]>([]);

  const handleMapClick = (e: maplibregl.MapMouseEvent) => {
    const map = mapRef.current;
    if (!map) return;

    if (routingPointsRef.current.length >= 2) {
      clearRouting();
    }

    const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    routingPointsRef.current.push(coords);

    if (routingPointsRef.current.length === 1) {
      setStartCoordStr(`${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`);
    } else if (routingPointsRef.current.length === 2) {
      setEndCoordStr(`${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`);
    }

    const markerColor = routingPointsRef.current.length === 1 ? '#00FFCC' : '#FF3B30';
    const marker = new maplibregl.Marker({ color: markerColor }).setLngLat(coords).addTo(map);
    routeMarkersRef.current.push(marker);

    if (routingPointsRef.current.length === 2) {
      calculateRoute(routingPointsRef.current[0], routingPointsRef.current[1]);
    }
  };

  const calculateRoute = async (start: number[], end: number[]) => {
    const requestJson = {
      locations: [
        { lon: start[0], lat: start[1], type: 'break' },
        { lon: end[0], lat: end[1], type: 'break' },
      ],
      costing: 'auto',
      directions_options: { units: 'km', language: 'zh-CN' },
    };

    try {
      const res = await fetch(`/route?json=${encodeURIComponent(JSON.stringify(requestJson))}`);
      if (!res.ok) throw new Error('导航路径生成失败');
      const data = await res.json();
      if (!data.trip || !data.trip.legs || data.trip.legs.length === 0) return;

      const leg = data.trip.legs[0];
      const coordinates = decodeValhallaShape(leg.shape);
      renderRouteLine(coordinates);

      setTripSummary(data.trip.summary);
      setManeuvers(leg.maneuvers || []);
    } catch (err) {
      console.error('❌ 导航总线报错:', err);
    }
  };

  const decodeValhallaShape = (str: string): [number, number][] => {
    let index = 0, len = str.length;
    let lat = 0, lng = 0;
    const coordinates: [number, number][] = [];

    while (index < len) {
      let b, shift = 0, result = 0;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += (result & 1 ? ~(result >> 1) : result >> 1);

      shift = 0;
      result = 0;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += (result & 1 ? ~(result >> 1) : result >> 1);

      coordinates.push([lng * 1e-6, lat * 1e-6]);
    }
    return coordinates;
  };

  const renderRouteLine = (coordinates: [number, number][]) => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getLayer('navigation-line')) map.removeLayer('navigation-line');
    if (map.getSource('navigation-source')) map.removeSource('navigation-source');

    map.addSource('navigation-source', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } },
    });

    const beforeLayer = map.getLayer('fences-layer-fill') ? 'fences-layer-fill' : undefined;
    map.addLayer(
      {
        id: 'navigation-line',
        type: 'line',
        source: 'navigation-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#FF2D55', 'line-width': 6, 'line-opacity': 0.9 },
      },
      beforeLayer
    );
  };

  const clearRouting = () => {
    routingPointsRef.current = [];
    routeMarkersRef.current.forEach((m) => m.remove());
    routeMarkersRef.current = [];
    if (mapRef.current && mapRef.current.getLayer('navigation-line')) {
      mapRef.current.removeLayer('navigation-line');
    }
    setStartCoordStr('');
    setEndCoordStr('');
    setTripSummary(null);
    setManeuvers([]);
  };

  return { startCoordStr, endCoordStr, tripSummary, maneuvers, handleMapClick };
}