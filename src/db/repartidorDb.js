import Dexie from "dexie";

export const repartidorDb = new Dexie("RepartidorDB");

// VERSION 1 — estructura base
repartidorDb.version(1).stores({
  // Perfil del repartidor — un solo doc, _key siempre "me"
  // Sincronizado desde Firestore repartidores/{id} via onSnapshot
  profile: "_key",

  // Config de la app — key/value
  // Ej: zonas de calor, parámetros operativos
  config: "key",

  // Historial de pedidos completados/cancelados de este repartidor
  // Sincronizado desde Firestore orders donde assignedDriverId == id
  historial: "id, dateKey, monthKey, status, createdAtMs",

  // Estadísticas agregadas por período
  // key = "hoy_2026-06-03" | "mes_2026-06" | "total"
  estadisticas: "key",

  // Valoraciones recibidas (extraídas de los pedidos con rating)
  valoraciones: "id, dateKey, score",
});

export default repartidorDb;
