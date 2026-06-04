// MapaNavegacion.jsx
// Mapa de navegación para pedido activo.
// Muestra posición real del repartidor, pin del destino y ruta OSRM por calles.
// OSRM público — sin API key, gratuito.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./MapaNavegacion.css";

const DEFAULT_CENTER = [-27.7951, -64.2615];
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";

// ── Íconos ─────────────────────────────────────────────────

function makeDriverIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="20" fill="#1a1f2e" stroke="#22c55e" stroke-width="2.5"/>
      <circle cx="24" cy="24" r="8"  fill="#22c55e"/>
      <circle cx="24" cy="24" r="3"  fill="white"/>
    </svg>`;
  return L.divIcon({ html: svg, className: "", iconSize: [48, 48], iconAnchor: [24, 24] });
}

function makeDestPin(label = "A", color = "#6366F1") {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48">
      <path d="M18 0C8 0 0 8.1 0 18c0 13.5 18 30 18 30S36 31.5 36 18C36 8.1 28 0 18 0z" fill="${color}"/>
      <circle cx="18" cy="18" r="10" fill="white"/>
      <text x="18" y="23" text-anchor="middle" font-size="13" font-weight="800"
        fill="${color}" font-family="Inter,system-ui,sans-serif">${label}</text>
    </svg>`;
  return L.divIcon({ html: svg, className: "", iconSize: [36, 48], iconAnchor: [18, 48] });
}

// ── Fetch ruta OSRM ────────────────────────────────────────

async function fetchOsrmRoute(from, to) {
  try {
    const url = `${OSRM_URL}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const json = await res.json();
    const coords = json.routes?.[0]?.geometry?.coordinates;
    if (!coords?.length) throw new Error("Sin coordenadas");
    // OSRM devuelve [lng, lat] → invertir a [lat, lng] para Leaflet
    return coords.map(([lng, lat]) => [lat, lng]);
  } catch {
    // Fallback: línea recta
    return [[from.lat, from.lng], [to.lat, to.lng]];
  }
}

// ── Componente ─────────────────────────────────────────────

export default function MapaNavegacion({
  driverCoords  = null,   // { lat, lng } — posición real del repartidor
  destination   = null,   // { lat, lng } — pickup o dropoff según el paso
  stepType      = "pickup", // "pickup" | "dropoff"
  followDriver  = true,   // si el mapa sigue al repartidor
}) {
  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const driverMarker  = useRef(null);
  const destMarker    = useRef(null);
  const routeLine     = useRef(null);
  const lastRouteKey  = useRef(null); // evita fetches innecesarios

  // ── Init mapa ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center:          DEFAULT_CENTER,
      zoom:            16,
      zoomControl:     false,
      attributionControl: false,
      dragging:        true,
      scrollWheelZoom: false,
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      { subdomains: "abcd", maxZoom: 19 }
    ).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current    = null;
      driverMarker.current = null;
      destMarker.current   = null;
      routeLine.current    = null;
    };
  }, []);

  // ── Posición del repartidor ────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !driverCoords?.lat || !driverCoords?.lng) return;

    const pos = [driverCoords.lat, driverCoords.lng];

    if (driverMarker.current) {
      driverMarker.current.setLatLng(pos);
    } else {
      driverMarker.current = L.marker(pos, {
        icon: makeDriverIcon(),
        zIndexOffset: 1000,
      }).addTo(map);
    }

    if (followDriver) {
      map.setView(pos, Math.max(map.getZoom(), 16), { animate: true, duration: 0.5 });
    }
  }, [driverCoords, followDriver]);

  // ── Destino + ruta OSRM ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Actualizar pin de destino
    if (destination?.lat && destination?.lng) {
      const pos   = [destination.lat, destination.lng];
      const color = stepType === "pickup" ? "#6366F1" : "#EF4444";
      const label = stepType === "pickup" ? "A" : "B";

      if (destMarker.current) destMarker.current.remove();
      destMarker.current = L.marker(pos, {
        icon: makeDestPin(label, color),
        zIndexOffset: 900,
      }).addTo(map);

      // Si no hay posición del repartidor, centrar en el destino
      if (!driverCoords?.lat) {
        map.setView(pos, 16);
      }
    } else {
      if (destMarker.current) { destMarker.current.remove(); destMarker.current = null; }
    }

    // Ruta OSRM — solo si tenemos ambas posiciones y cambió el destino
    const routeKey = destination?.lat
      ? `${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`
      : null;

    if (!routeKey || routeKey === lastRouteKey.current) return;
    lastRouteKey.current = routeKey;

    if (!driverCoords?.lat || !driverCoords?.lng || !destination?.lat || !destination?.lng) return;

    fetchOsrmRoute(driverCoords, destination).then((coords) => {
      if (!mapRef.current) return;
      if (routeLine.current) { routeLine.current.remove(); }
      routeLine.current = L.polyline(coords, {
        color:   stepType === "pickup" ? "#6366F1" : "#EF4444",
        weight:  5,
        opacity: 0.85,
        lineCap: "round",
      }).addTo(mapRef.current);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, stepType]);

  // Actualizar ruta cuando el repartidor se mueve significativamente (~150m)
  useEffect(() => {
    if (!driverCoords?.lat || !destination?.lat) return;
    if (!lastRouteKey.current) return; // aún no se trazó la primera ruta

    fetchOsrmRoute(driverCoords, destination).then((coords) => {
      if (!mapRef.current) return;
      if (routeLine.current) { routeLine.current.remove(); }
      routeLine.current = L.polyline(coords, {
        color:   stepType === "pickup" ? "#6366F1" : "#EF4444",
        weight:  5,
        opacity: 0.85,
        lineCap: "round",
      }).addTo(mapRef.current);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverCoords]);

  return (
    <div className="mapa-nav">
      <div ref={containerRef} className="mapa-nav__map" />
    </div>
  );
}
