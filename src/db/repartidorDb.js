import Dexie from "dexie";

export const repartidorDb = new Dexie("RepartidorDB");

repartidorDb.version(1).stores({
  profile:      "_key",
  config:       "key",
  historial:    "id, dateKey, monthKey, status, createdAtMs",
  estadisticas: "key",
  valoraciones: "id, dateKey, score",
});

// VERSION 2 — agrega store de pagos
repartidorDb.version(2).stores({
  profile:      "_key",
  config:       "key",
  historial:    "id, dateKey, monthKey, status, createdAtMs",
  estadisticas: "key",
  valoraciones: "id, dateKey, score",
  pagos:        "id, dateKey, syncStatus, repartidorId",
});

export default repartidorDb;
