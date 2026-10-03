'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { km } from '@workforce/contracts';

type Coordinates = { latitude: number; longitude: number };

const pinIcon = L.divIcon({
  className: 'site-location-pin',
  html: '<span aria-hidden="true"></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

function Recenter({ position }: { position: [number, number] }) {
  const map = useMap();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Coordinate fields may change one character at a time. Delaying the pan
    // prevents Leaflet from fighting the user while they drag or click the pin.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      map.panTo(position, { animate: true, duration: 0.25 });
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [map, position]);
  return null;
}

function FitAfterModalOpen() {
  const map = useMap();
  useEffect(() => {
    const frame = requestAnimationFrame(() => map.invalidateSize());
    return () => cancelAnimationFrame(frame);
  }, [map]);
  return null;
}

function MapClick({ onChange }: { onChange: (coordinates: Coordinates) => void }) {
  useMapEvents({
    click(event) {
      onChange({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  return null;
}

export default function SiteLocationPicker({
  latitude,
  longitude,
  radiusMeters,
  onChange,
}: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  onChange: (coordinates: Coordinates) => void;
}) {
  const position = useMemo<[number, number]>(() => [latitude, longitude], [latitude, longitude]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      <MapContainer
        center={position}
        zoom={17}
        className="h-44 sm:h-48 w-full"
        scrollWheelZoom={false}
        doubleClickZoom={false}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitAfterModalOpen />
        <Recenter position={position} />
        <MapClick onChange={onChange} />
        <Circle center={position} radius={Math.max(radiusMeters, 1)} pathOptions={{ color: '#0284c7', weight: 2, fillOpacity: 0.06 }} />
        <Marker
          position={position}
          icon={pinIcon}
          draggable
          eventHandlers={{
            dragend(event) {
              const point = event.target.getLatLng();
              onChange({ latitude: point.lat, longitude: point.lng });
            },
          }}
        />
      </MapContainer>
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-[11px] text-slate-600">
        <span>{km.sites.mapHint}</span>
        <span className="shrink-0 font-mono">{latitude.toFixed(6)}, {longitude.toFixed(6)}</span>
      </div>
    </div>
  );
}
