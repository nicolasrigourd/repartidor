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

// VERSION 3 — pedidos viejos ocultados localmente desde Pedidos (swipe-to-delete).
// No borra el doc de historial (el listener de Firestore lo volvería a traer en
// el próximo resync), solo guarda el id para filtrarlo siempre del listado.
repartidorDb.version(3).stores({
  profile:          "_key",
  config:           "key",
  historial:        "id, dateKey, monthKey, status, createdAtMs",
  estadisticas:     "key",
  valoraciones:     "id, dateKey, score",
  pagos:            "id, dateKey, syncStatus, repartidorId",
  historialOcultos: "id",
});

export default repartidorDb;
