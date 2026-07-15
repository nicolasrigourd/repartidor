import { httpsCallable } from "firebase/functions";
import { functions } from "../firebaseconfig";

// calcularRuta vive en Cadev2/functions — proxy server-side a la Routes API
// de Google (la key nunca toca el celu del repartidor). Devuelve la
// geometría de la ruta + los pasos de texto para el cartel de "próxima
// indicación" y la lectura en voz alta.
const llamarCalcularRuta = httpsCallable(functions, "calcularRuta");

export async function calcularRuta(origen, destino) {
  if (!origen?.lat || !origen?.lng || !destino?.lat || !destino?.lng) return null;

  try {
    const { data } = await llamarCalcularRuta({
      origen:  { lat: origen.lat,  lng: origen.lng },
      destino: { lat: destino.lat, lng: destino.lng },
    });
    return data || null;
  } catch (err) {
    console.warn("⚠️ No se pudo calcular la ruta:", err?.message);
    return null;
  }
}

function toRad(deg) { return (deg * Math.PI) / 180; }

export function haversineM(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Distancia mínima de un punto a un segmento (para saber qué tan lejos
// está el repartidor de la polyline y decidir si hay que recalcular).
function distanciaAPuntoEnSegmento(p, a, b) {
  const A = p.lat - a.lat, B = p.lng - a.lng;
  const C = b.lat - a.lat, D = b.lng - a.lng;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  const t = lenSq !== 0 ? Math.max(0, Math.min(1, dot / lenSq)) : 0;
  const proyeccion = { lat: a.lat + t * C, lng: a.lng + t * D };
  return haversineM(p, proyeccion);
}

// Menor distancia del repartidor a cualquier tramo de la polyline —
// si es muy grande, se desvió y conviene recalcular la ruta.
export function distanciaAPolyline(punto, polyline = []) {
  if (!punto || polyline.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = distanciaAPuntoEnSegmento(punto, polyline[i], polyline[i + 1]);
    if (d < min) min = d;
  }
  return min;
}
