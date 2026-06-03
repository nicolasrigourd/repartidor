// MapaRepartidor.jsx
// Mapa real con Leaflet + CartoDB Positron (calles legibles, aspecto limpio)
// Muestra: posición del repartidor, zonas de calor, pin de pickup cuando hay oferta

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./MapaRepartidor.css";

// ── Centro por defecto (Santiago del Estero) ─────────────
const DEFAULT_CENTER = [-27.7951, -64.2615];
const DEFAULT_ZOOM   = 14;

// ── Colores de zona ────────────────────────────────────────
const ZONA_COLORS = {
  hot:    { fill: "rgba(239,68,68,0.25)",  stroke: "rgba(239,68,68,0.7)",  label: "#EF4444" },
  warm:   { fill: "rgba(249,115,22,0.20)", stroke: "rgba(249,115,22,0.6)", label: "#F97316" },
  cool:   { fill: "rgba(59,130,246,0.15)", stroke: "rgba(59,130,246,0.5)", label: "#3B82F6" },
  medium: { fill: "rgba(249,115,22,0.20)", stroke: "rgba(249,115,22,0.6)", label: "#F97316" },
  low:    { fill: "rgba(59,130,246,0.15)", stroke: "rgba(59,130,246,0.5)", label: "#3B82F6" },
  high:   { fill: "rgba(239,68,68,0.25)",  stroke: "rgba(239,68,68,0.7)",  label: "#EF4444" },
};

// ── Ícono del conductor ────────────────────────────────────
function makeDriverIcon(workStatus) {
  const colors = {
    online:   "#22C55E",
    busy:     "#F97316",
    starting: "#3B82F6",
    error:    "#EF4444",
    offline:  "#6B7280",
  };
  const color = colors[workStatus] || colors.offline;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r="20" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="2"/>
      <circle cx="22" cy="22" r="10" fill="${color}"/>
      <circle cx="22" cy="22" r="4"  fill="white"/>
    </svg>`;

  return L.divIcon({
    html: svg,
    className: "",
    iconSize:   [44, 44],
    iconAnchor: [22, 22],
  });
}

// ── Ícono de pin (pickup/dropoff) ──────────────────────────
function makePinIcon(label = "A", color = "#6366F1") {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
      <path d="M18 0C8 0 0 8 0 18c0 13 18 26 18 26S36 31 36 18C36 8 28 0 18 0z" fill="${color}"/>
      <circle cx="18" cy="18" r="10" fill="white"/>
      <text x="18" y="23" text-anchor="middle" font-size="13" font-weight="700" fill="${color}" font-family="Inter,sans-serif">${label}</text>
    </svg>`;

  return L.divIcon({
    html: svg,
    className: "",
    iconSize:   [36, 44],
    iconAnchor: [18, 44],
  });
}

// ─────────────────────────────────────────────────────────

export default function MapaRepartidor({
  workStatus   = "offline",
  liveCoords   = null,     // { lat, lng } posición del conductor
  zonas        = [],       // [{ id, label, lat, lng, radio, level }]
  ofertaCoords = null,     // { lat, lng } posición del pickup (cuando hay oferta)
  pedidoActivo = null,     // { pickup.coords, dropoff.coords } para la ruta activa
}) {
  const mapRef       = useRef(null);
  const mapInstance  = useRef(null);
  const driverMarker = useRef(null);
  const pickupMarker = useRef(null);
  const dropoffMarker = useRef(null);
  const routeLine    = useRef(null);
  const zonaLayers   = useRef([]);

  // ── Inicializar mapa ─────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      center:          DEFAULT_CENTER,
      zoom:            DEFAULT_ZOOM,
      zoomControl:     false,
      attributionControl: false,
      dragging:        true,
      scrollWheelZoom: true,
      doubleClickZoom: false,
    });

    // CartoDB Positron — calles legibles, aspecto limpio y profesional
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      { subdomains: "abcd", maxZoom: 19 }
    ).addTo(map);

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  // ── Marker del conductor ─────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const icon = makeDriverIcon(workStatus);

    if (liveCoords?.lat && liveCoords?.lng) {
      const pos = [liveCoords.lat, liveCoords.lng];
      if (driverMarker.current) {
        driverMarker.current.setLatLng(pos).setIcon(icon);
      } else {
        driverMarker.current = L.marker(pos, { icon, zIndexOffset: 1000 }).addTo(map);
        // Centrar el mapa la primera vez
        map.setView(pos, map.getZoom());
      }
    } else if (driverMarker.current) {
      driverMarker.current.setIcon(icon);
    }
  }, [liveCoords, workStatus]);

  // ── Zonas de calor ───────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    // Limpiar zonas anteriores
    zonaLayers.current.forEach((l) => l.remove());
    zonaLayers.current = [];

    zonas.forEach((zona) => {
      if (!zona.lat || !zona.lng || !zona.radio) return;

      const cfg = ZONA_COLORS[zona.level] || ZONA_COLORS.cool;

      const circle = L.circle([zona.lat, zona.lng], {
        radius:      zona.radio,
        color:       cfg.stroke,
        fillColor:   cfg.fill,
        fillOpacity: 1,
        weight:      1.5,
      }).addTo(map);

      // Label flotante sobre la zona
      const label = L.divIcon({
        html: `<div class="zona-label" style="color:${cfg.label}">${zona.label}</div>`,
        className: "",
        iconSize:  [80, 24],
        iconAnchor:[40, 12],
      });
      const labelMarker = L.marker([zona.lat, zona.lng], { icon: label, interactive: false }).addTo(map);

      zonaLayers.current.push(circle, labelMarker);
    });
  }, [zonas]);

  // ── Pin de oferta (pickup) ────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (ofertaCoords?.lat && ofertaCoords?.lng) {
      const pos = [ofertaCoords.lat, ofertaCoords.lng];
      if (pickupMarker.current) {
        pickupMarker.current.setLatLng(pos);
      } else {
        pickupMarker.current = L.marker(pos, { icon: makePinIcon("A", "#6366F1"), zIndexOffset: 900 }).addTo(map);
      }
      // Ajustar vista para mostrar conductor + pickup
      if (liveCoords?.lat) {
        const bounds = L.latLngBounds([pos, [liveCoords.lat, liveCoords.lng]]);
        map.fitBounds(bounds, { padding: [60, 60] });
      }
    } else if (pickupMarker.current) {
      pickupMarker.current.remove();
      pickupMarker.current = null;
    }
  }, [ofertaCoords, liveCoords]);

  // ── Pedido activo: pickup + dropoff + línea ───────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    // Limpiar anteriores
    if (dropoffMarker.current) { dropoffMarker.current.remove(); dropoffMarker.current = null; }
    if (routeLine.current)     { routeLine.current.remove(); routeLine.current = null; }

    if (pedidoActivo) {
      const pickupLatLng  = pedidoActivo.pickup?.coords
        ? [pedidoActivo.pickup.coords.lat, pedidoActivo.pickup.coords.lng]
        : null;
      const dropoffLatLng = pedidoActivo.dropoff?.coords
        ? [pedidoActivo.dropoff.coords.lat, pedidoActivo.dropoff.coords.lng]
        : null;

      if (pickupLatLng && !pickupMarker.current) {
        pickupMarker.current = L.marker(pickupLatLng, { icon: makePinIcon("A", "#6366F1") }).addTo(map);
      }
      if (dropoffLatLng) {
        dropoffMarker.current = L.marker(dropoffLatLng, { icon: makePinIcon("B", "#EF4444") }).addTo(map);
      }
      if (pickupLatLng && dropoffLatLng) {
        routeLine.current = L.polyline([pickupLatLng, dropoffLatLng], {
          color: "#6366F1", weight: 3, opacity: 0.7, dashArray: "8 6",
        }).addTo(map);
        map.fitBounds(L.latLngBounds([pickupLatLng, dropoffLatLng]), { padding: [60, 80] });
      }
    } else {
      if (pickupMarker.current) { pickupMarker.current.remove(); pickupMarker.current = null; }
    }
  }, [pedidoActivo]);

  return (
    <div className="mapa-repartidor">
      <div ref={mapRef} className="mapa-repartidor__map" />
    </div>
  );
}
