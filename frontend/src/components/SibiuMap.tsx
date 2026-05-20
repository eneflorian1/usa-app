'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Zone {
    id: string; name: string; lat: number; lng: number; radius_km: number;
    tags: string[]; price_index: number; student_friendly: boolean;
    family_friendly: boolean; noise_level: string; poi: string[];
}

interface POI {
    key: string; name: string; lat: number; lng: number; area_id: string; radius_km: number;
}

interface GeoPreference {
    _id: string; resolved_area: string; city: string; price_max?: number;
    rooms?: number[]; monitor?: { active: boolean; whatsapp_chatId?: string };
    geo?: { lat: number; lng: number };
}

interface SibiuMapProps {
    zones: Zone[];
    pois: POI[];
    preferences: GeoPreference[];
    onZoneClick?: (zone: Zone) => void;
    searchMarker?: { lat: number; lng: number; label: string } | null;
    highlightZoneId?: string | null;
}

// Color zones by price_index
function zoneColor(priceIndex: number): string {
    if (priceIndex >= 1.3) return '#ef4444'; // red — expensive
    if (priceIndex >= 1.1) return '#f59e0b'; // amber
    if (priceIndex <= 0.88) return '#22c55e'; // green — affordable
    return '#6366f1'; // violet — mid
}

function poiIcon(key: string): string {
    if (/mall|shopping|promenada/i.test(key)) return '🛍️';
    if (/ulbs|universitate|facultate|campus/i.test(key)) return '🎓';
    if (/aeroport/i.test(key)) return '✈️';
    if (/gara/i.test(key)) return '🚂';
    if (/spital/i.test(key)) return '🏥';
    if (/parc|dumbrava/i.test(key)) return '🌳';
    if (/piata/i.test(key)) return '🏛️';
    return '📍';
}

export default function SibiuMap({ zones, pois, preferences, onZoneClick, searchMarker, highlightZoneId }: SibiuMapProps) {
    const mapRef = useRef<L.Map | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const circlesRef = useRef<Map<string, L.Circle>>(new Map());
    const searchMarkerRef = useRef<L.Marker | null>(null);
    const prefCirclesRef = useRef<L.Circle[]>([]);
    const [ready, setReady] = useState(false);

    // Init map
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = L.map(containerRef.current, {
            center: [45.7973, 24.1519],
            zoom: 13,
            zoomControl: false,
        });

        L.control.zoom({ position: 'bottomright' }).addTo(map);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
            maxZoom: 19,
        }).addTo(map);

        mapRef.current = map;
        setReady(true);

        return () => {
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // Draw zones
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready || zones.length === 0) return;

        // Clear old circles
        circlesRef.current.forEach(c => c.remove());
        circlesRef.current.clear();

        for (const zone of zones) {
            if (zone.id === 'sibiu_general') continue;
            const isHighlighted = zone.id === highlightZoneId;
            const color = isHighlighted ? '#7c3aed' : zoneColor(zone.price_index);

            const circle = L.circle([zone.lat, zone.lng], {
                radius: zone.radius_km * 1000,
                color,
                fillColor: color,
                fillOpacity: isHighlighted ? 0.35 : 0.15,
                weight: isHighlighted ? 2.5 : 1.5,
                dashArray: isHighlighted ? undefined : '4 3',
            }).addTo(map);

            // Label marker
            const label = L.divIcon({
                className: '',
                html: `<div style="
                    background: ${isHighlighted ? '#7c3aed' : 'white'};
                    color: ${isHighlighted ? 'white' : '#374151'};
                    border: 1.5px solid ${color};
                    border-radius: 8px;
                    padding: 2px 7px;
                    font-size: 11px;
                    font-weight: 600;
                    white-space: nowrap;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.15);
                    pointer-events: none;
                ">${zone.name}</div>`,
                iconAnchor: [0, 0],
            });
            L.marker([zone.lat, zone.lng], { icon: label, interactive: false }).addTo(map);

            circle.on('click', () => onZoneClick?.(zone));
            circle.bindTooltip(`
                <strong>${zone.name}</strong><br/>
                💰 Index preț: ${zone.price_index}x<br/>
                🏷️ ${zone.tags.slice(0, 3).join(', ')}
            `, { sticky: true });

            circlesRef.current.set(zone.id, circle);
        }
    }, [zones, ready, highlightZoneId, onZoneClick]);

    // Draw POIs
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready || pois.length === 0) return;

        for (const poi of pois) {
            if (!poi.lat || !poi.lng) continue;
            const emoji = poiIcon(poi.key);
            const icon = L.divIcon({
                className: '',
                html: `<div style="font-size:18px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3))">${emoji}</div>`,
                iconAnchor: [9, 9],
            });
            L.marker([poi.lat, poi.lng], { icon, zIndexOffset: 100 })
                .addTo(map)
                .bindTooltip(`<strong>${poi.name}</strong>`, { direction: 'top' });
        }
    }, [pois, ready]);

    // Draw preferences / monitor areas
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready) return;

        prefCirclesRef.current.forEach(c => c.remove());
        prefCirclesRef.current = [];

        for (const pref of preferences) {
            if (!pref.geo?.lat || !pref.geo?.lng) continue;
            const c = L.circle([pref.geo.lat, pref.geo.lng], {
                radius: 2000,
                color: '#7c3aed',
                fillColor: '#7c3aed',
                fillOpacity: 0.08,
                weight: 2,
                dashArray: '6 4',
            }).addTo(map);
            c.bindTooltip(`🔔 Monitor: ${pref.resolved_area}${pref.price_max ? ` ≤${pref.price_max}€` : ''}`, { sticky: true });
            prefCirclesRef.current.push(c);
        }
    }, [preferences, ready]);

    // Search marker
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready) return;

        if (searchMarkerRef.current) {
            searchMarkerRef.current.remove();
            searchMarkerRef.current = null;
        }

        if (searchMarker) {
            const icon = L.divIcon({
                className: '',
                html: `<div style="
                    background:#7c3aed; color:white; border-radius:50% 50% 50% 0;
                    width:28px; height:28px; transform:rotate(-45deg);
                    display:flex; align-items:center; justify-content:center;
                    font-size:13px; box-shadow:0 2px 6px rgba(0,0,0,0.3);
                "><span style="transform:rotate(45deg)">📍</span></div>`,
                iconAnchor: [14, 28],
            });
            const m = L.marker([searchMarker.lat, searchMarker.lng], { icon, zIndexOffset: 999 })
                .addTo(map)
                .bindPopup(`<strong>${searchMarker.label}</strong>`).openPopup();
            map.flyTo([searchMarker.lat, searchMarker.lng], 15, { duration: 1 });
            searchMarkerRef.current = m;
        }
    }, [searchMarker, ready]);

    // Pan to highlighted zone
    useEffect(() => {
        if (!mapRef.current || !ready || !highlightZoneId) return;
        const zone = zones.find(z => z.id === highlightZoneId);
        if (zone) mapRef.current.flyTo([zone.lat, zone.lng], 14, { duration: 0.8 });
    }, [highlightZoneId, zones, ready]);

    return <div ref={containerRef} className="w-full h-full rounded-2xl overflow-hidden" />;
}
