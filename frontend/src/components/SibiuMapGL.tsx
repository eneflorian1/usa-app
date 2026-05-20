'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Supercluster from 'supercluster';

interface Zone {
    id: string; name: string; lat: number; lng: number; radius_km: number;
    tags: string[]; price_index: number; student_friendly: boolean;
    family_friendly: boolean; noise_level: string; poi: string[];
}

interface Listing {
    id: string; lat: number; lng: number; zone_id: string; title: string;
    price: number; price_m2: number; rooms: number; area_sqm: number;
    deal_score: number; negotiation_score: number; verdict: 'hot' | 'warm' | 'cold';
    is_new: boolean; price_drop: boolean; url: string; published_ago: string;
}

interface MarketData {
    [zoneId: string]: {
        avg_price_m2: number; med_price_m2: number; market_score: number;
        trend: string; deal_count: number; avg_days: number; liquidity: string;
        investment_score: number; family_score: number; student_score: number;
        noise: string; green_space: number;
    };
}

interface SibiuMapGLProps {
    zones: Zone[];
    listings: Listing[];
    marketData: MarketData;
    layers: {
        zones: boolean;
        listings: boolean;
    };
    drawMode: boolean;
    highlightZoneId?: string | null;
    onZoneClick?: (zone: Zone, insights: unknown) => void;
    onListingClick?: (listing: Listing) => void;
    onPolygonComplete?: (coordinates: [number, number][]) => void;
    searchMarker?: { lat: number; lng: number; label: string } | null;
    compareZones?: string[];
}

function dealColor(score: number): string {
    if (score >= 85) return '#16a34a';
    if (score >= 70) return '#ca8a04';
    return '#dc2626';
}

function priceColor(priceM2: number, avg: number): string {
    const ratio = priceM2 / avg;
    if (ratio <= 0.85) return '#16a34a';
    if (ratio <= 1.0) return '#65a30d';
    if (ratio <= 1.15) return '#ca8a04';
    return '#dc2626';
}

// Build circle GeoJSON polygon approximation
function circleGeoJSON(lat: number, lng: number, radiusKm: number, steps = 64) {
    const coords: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * 2 * Math.PI;
        const dlat = (radiusKm / 111) * Math.sin(angle);
        const dlng = (radiusKm / (111 * Math.cos(lat * Math.PI / 180))) * Math.cos(angle);
        coords.push([lng + dlng, lat + dlat]);
    }
    return coords;
}

export default function SibiuMapGL({
    zones, listings, marketData, layers, drawMode,
    highlightZoneId, onZoneClick, onListingClick, onPolygonComplete,
    searchMarker, compareZones = [],
}: SibiuMapGLProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const popupRef = useRef<maplibregl.Popup | null>(null);
    const searchMarkerRef = useRef<maplibregl.Marker | null>(null);
    const drawPointsRef = useRef<[number, number][]>([]);
    const drawMarkersRef = useRef<maplibregl.Marker[]>([]);
    const drawLineRef = useRef<string | null>(null);
    const [ready, setReady] = useState(false);

    // Init map
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = new maplibregl.Map({
            container: containerRef.current,
            style: {
                version: 8,
                sources: {
                    osm: {
                        type: 'raster',
                        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                        tileSize: 256,
                        attribution: '© OpenStreetMap contributors',
                    },
                },
                layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
            },
            center: [24.1519, 45.7973],
            zoom: 13,
        });

        map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
        map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

        map.on('load', () => {
            setReady(true);
        });

        mapRef.current = map;

        return () => {
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // Draw zone + heatmap layers
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready || zones.length === 0) return;

        // Remove old
        ['zones-fill', 'zones-outline', 'zones-highlight'].forEach(id => {
            if (map.getLayer(id)) map.removeLayer(id);
        });
        if (map.getSource('zones-source')) map.removeSource('zones-source');

        const avgPrice = Object.values(marketData).reduce((s, m) => s + m.avg_price_m2, 0) / Math.max(1, Object.keys(marketData).length);

        // Zones GeoJSON
        const zoneFeatures = zones
            .filter(z => z.id !== 'sibiu_general')
            .map(z => {
                const m = marketData[z.id];
                const isHighlight = z.id === highlightZoneId || compareZones.includes(z.id);
                const color = isHighlight ? '#7c3aed' : (m ? priceColor(m.avg_price_m2, avgPrice) : '#6366f1');
                return {
                    type: 'Feature' as const,
                    geometry: { type: 'Polygon' as const, coordinates: [circleGeoJSON(z.lat, z.lng, z.radius_km)] },
                    properties: { id: z.id, name: z.name, color, isHighlight, price_index: z.price_index, avg_price_m2: m?.avg_price_m2 ?? 0 },
                };
            });

        map.addSource('zones-source', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: zoneFeatures },
        });

        if (layers.zones) {
            map.addLayer({
                id: 'zones-fill',
                type: 'fill',
                source: 'zones-source',
                paint: {
                    'fill-color': ['get', 'color'],
                    'fill-opacity': ['case', ['get', 'isHighlight'], 0.35, 0.12],
                },
            });

            map.addLayer({
                id: 'zones-outline',
                type: 'line',
                source: 'zones-source',
                paint: {
                    'line-color': ['get', 'color'],
                    'line-width': ['case', ['get', 'isHighlight'], 2.5, 1.5],
                    'line-dasharray': [4, 3],
                },
            });
        }

        // Zone click
        map.on('click', 'zones-fill', async (e) => {
            const feature = e.features?.[0];
            if (!feature) return;
            const zone = zones.find(z => z.id === feature.properties.id);
            if (!zone || !onZoneClick) return;
            try {
                const resp = await fetch(`/api/geo/insights/${zone.id}`, { method: 'POST' });
                const insights = await resp.json();
                onZoneClick(zone, insights);
            } catch {
                onZoneClick(zone, null);
            }
        });

        map.on('mouseenter', 'zones-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'zones-fill', () => { map.getCanvas().style.cursor = ''; });

    }, [zones, marketData, ready, layers.zones, highlightZoneId, compareZones]);

    // Listing clusters
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready) return;

        ['clusters', 'cluster-count', 'unclustered-point'].forEach(id => {
            if (map.getLayer(id)) map.removeLayer(id);
        });
        if (map.getSource('listings-source')) map.removeSource('listings-source');

        if (!layers.listings || listings.length === 0) return;

        // Use Supercluster via GeoJSON clustering in MapLibre
        map.addSource('listings-source', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: listings.map(l => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [l.lng, l.lat] },
                    properties: { ...l },
                })),
            },
            cluster: true,
            clusterMaxZoom: 15,
            clusterRadius: 50,
        });

        map.addLayer({
            id: 'clusters',
            type: 'circle',
            source: 'listings-source',
            filter: ['has', 'point_count'],
            paint: {
                'circle-color': [
                    'step', ['get', 'point_count'],
                    '#4ade80', 5,
                    '#facc15', 10,
                    '#f87171',
                ],
                'circle-radius': ['step', ['get', 'point_count'], 20, 5, 28, 10, 36],
                'circle-opacity': 0.85,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#fff',
            },
        });

        map.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: 'listings-source',
            filter: ['has', 'point_count'],
            layout: {
                'text-field': '{point_count_abbreviated}',
                'text-size': 13,
                'text-font': ['Open Sans Bold'],
            },
            paint: { 'text-color': '#111' },
        });

        map.addLayer({
            id: 'unclustered-point',
            type: 'circle',
            source: 'listings-source',
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': [
                    'case',
                    ['>=', ['get', 'deal_score'], 85], '#16a34a',
                    ['>=', ['get', 'deal_score'], 70], '#ca8a04',
                    '#dc2626',
                ],
                'circle-radius': 10,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#fff',
                'circle-opacity': 0.9,
            },
        });

        map.on('click', 'clusters', async (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
            const clusterId = features[0].properties.cluster_id;
            const src = map.getSource('listings-source') as maplibregl.GeoJSONSource;
            try {
                const zoom = await src.getClusterExpansionZoom(clusterId);
                map.easeTo({ center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom || 14 });
            } catch { /* ignore */ }
        });

        map.on('click', 'unclustered-point', (e) => {
            const feature = e.features?.[0];
            if (!feature || !onListingClick) return;
            onListingClick(feature.properties as Listing);
        });

        map.on('mouseenter', 'unclustered-point', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'unclustered-point', () => { map.getCanvas().style.cursor = ''; });
        map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });

    }, [listings, ready, layers.listings]);

    // Search marker
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready) return;

        if (searchMarkerRef.current) {
            searchMarkerRef.current.remove();
            searchMarkerRef.current = null;
        }

        if (searchMarker) {
            const el = document.createElement('div');
            el.innerHTML = `<div style="background:#7c3aed;color:white;border-radius:50% 50% 50% 0;width:28px;height:28px;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><span style="transform:rotate(45deg)">📍</span></div>`;
            const marker = new maplibregl.Marker({ element: el.firstChild as HTMLElement })
                .setLngLat([searchMarker.lng, searchMarker.lat])
                .setPopup(new maplibregl.Popup().setText(searchMarker.label))
                .addTo(map);
            marker.getPopup().addTo(map);
            map.flyTo({ center: [searchMarker.lng, searchMarker.lat], zoom: 15, duration: 1000 });
            searchMarkerRef.current = marker;
        }
    }, [searchMarker, ready]);

    // Pan to highlighted zone
    useEffect(() => {
        if (!mapRef.current || !ready || !highlightZoneId) return;
        const zone = zones.find(z => z.id === highlightZoneId);
        if (zone) mapRef.current.flyTo({ center: [zone.lng, zone.lat], zoom: 14, duration: 800 });
    }, [highlightZoneId, zones, ready]);

    // Draw polygon mode
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready) return;

        if (!drawMode) {
            // Clear draw state
            drawPointsRef.current = [];
            drawMarkersRef.current.forEach(m => m.remove());
            drawMarkersRef.current = [];
            if (drawLineRef.current) {
                if (map.getLayer('draw-line')) map.removeLayer('draw-line');
                if (map.getSource('draw-source')) map.removeSource('draw-source');
                drawLineRef.current = null;
            }
            map.getCanvas().style.cursor = '';
            return;
        }

        map.getCanvas().style.cursor = 'crosshair';

        const handleClick = (e: maplibregl.MapMouseEvent) => {
            if (!drawMode) return;
            const { lng, lat } = e.lngLat;
            drawPointsRef.current.push([lng, lat]);

            const el = document.createElement('div');
            el.style.cssText = 'width:10px;height:10px;background:#7c3aed;border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4)';
            const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
            drawMarkersRef.current.push(marker);

            // Update line
            if (map.getSource('draw-source')) {
                (map.getSource('draw-source') as maplibregl.GeoJSONSource).setData({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: drawPointsRef.current },
                    properties: {},
                });
            } else {
                map.addSource('draw-source', {
                    type: 'geojson',
                    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: drawPointsRef.current }, properties: {} },
                });
                map.addLayer({
                    id: 'draw-line',
                    type: 'line',
                    source: 'draw-source',
                    paint: { 'line-color': '#7c3aed', 'line-width': 2, 'line-dasharray': [4, 2] },
                });
                drawLineRef.current = 'draw-line';
            }
        };

        const handleDblClick = () => {
            if (drawPointsRef.current.length >= 3) {
                onPolygonComplete?.(drawPointsRef.current);
            }
        };

        map.on('click', handleClick);
        map.on('dblclick', handleDblClick);

        return () => {
            map.off('click', handleClick);
            map.off('dblclick', handleDblClick);
        };
    }, [drawMode, ready]);

    return <div ref={containerRef} className="w-full h-full" />;
}
