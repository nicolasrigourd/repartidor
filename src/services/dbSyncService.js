import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "../firebaseconfig";
import { repartidorDb } from "../db/repartidorDb";

// ── Helpers ────────────────────────────────────────────────
function toDateKey(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0, 10);
}

function toMonthKey(dateKey) {
  return dateKey ? dateKey.slice(0, 7) : "";
}

function extractEarnings(order) {
  return (
    Number(order.pricing?.price)          ||
    Number(order.pricing?.driverEarnings) ||
    Number(order.pricing?.deliveryFee)    ||
    Number(order.pricing?.total)          ||
    0
  );
}

function extractOriginName(order) {
  return (
    order.pickup?.contact?.fullName ||
    order.customer?.name ||
    order.customerName ||
    ""
  );
}

function extractDestinationName(order) {
  return (
    order.recipient?.name ||
    order.dropoff?.contact?.fullName ||
    order.customerName ||
    ""
  );
}

// ── Estado interno ────────────────────────────────────────
let unsubscribers = [];
let syncRepartidorId = null;

// ── API pública ───────────────────────────────────────────

export function startSync(repartidorId) {
  if (!repartidorId) return;
  stopSync();
  syncRepartidorId = repartidorId;
  _syncProfile(repartidorId);
  _syncHistorial(repartidorId);
}

// Llamado desde App.jsx cada vez que onSnapshot del repartidor recibe datos frescos
export async function updateProfile(data) {
  if (!data) return;
  return repartidorDb.profile
    .put({ _key: "me", ...data, _syncedAt: Date.now() })
    .catch((err) => console.error("[dbSync] Error guardando perfil en IndexedDB:", err));
}

export function stopSync() {
  unsubscribers.forEach((fn) => fn());
  unsubscribers = [];
  syncRepartidorId = null;
}


// ── Sync perfil ──────────────────────────────────────────
// Escucha repartidores/{id} en tiempo real y mantiene IndexedDB actualizado

function _syncProfile(repartidorId) {
  const unsub = onSnapshot(
    doc(db, "repartidores", String(repartidorId)),
    (snap) => {
      if (!snap.exists()) return;
      updateProfile(snap.data());
    },
    (err) => console.error("[dbSync] Error sincronizando perfil:", err)
  );
  unsubscribers.push(unsub);
}

// ── Sync historial ────────────────────────────────────────
// Firestore orders donde el repartidor fue asignado
// → stores "historial", "valoraciones"
// → recomputa "estadisticas"

function _syncHistorial(repartidorId) {
  // Trae los últimos 200 pedidos finalizados/cancelados de este repartidor.
  // El listener auto-poda IndexedDB: cuando un doc sale del top-200 al llegar
  // uno más nuevo, Firestore emite un docChange "removed" (manejado abajo).
  const q = query(
    collection(db, "orders"),
    where("assignedDriverId", "==", repartidorId),
    where("status", "in", ["completed", "cancelled"]),
    orderBy("createdAtMs", "desc"),
    limit(200)
  );

  const unsub = onSnapshot(
    q,
    async (snap) => {
      const toDelete = [];
      const toUpsert = [];
      const toUpsertVal = [];

      snap.docChanges().forEach((change) => {
        const id = change.doc.id;

        if (change.type === "removed") {
          toDelete.push(id);
          return;
        }

        const data = change.doc.data();
        const dateKey  = data.dateKey  || toDateKey(data.createdAt || data.createdAtMs);
        const monthKey = data.monthKey || toMonthKey(dateKey);

        toUpsert.push({
          id,
          status:      data.status      || "",
          dateKey,
          monthKey,
          createdAtMs: Number(data.createdAtMs || 0),
          completedAtMs: Number(data.delivery?.finishedAtMs || data.finishedAtMs || 0),

          pickup:  data.pickup  || null,
          dropoff: data.dropoff || null,
          originName:      extractOriginName(data),
          destinationName: extractDestinationName(data),

          orderType: data.service?.label || data.service?.type || data.orderType || data.tipoPedido || "",
          pricing:   data.pricing || null,
          payment:   data.payment || null,
          earnings:  extractEarnings(data),

          offer:     data.offer    || null,
          delivery:  data.delivery || null,
          rating:    data.rating   || null,

          _syncedAt: Date.now(),
        });

        // Si tiene valoración, la guardamos separada
        if (data.rating?.score) {
          toUpsertVal.push({
            id,
            score:   Number(data.rating.score),
            comment: data.rating.comment || "",
            dateKey,
            _syncedAt: Date.now(),
          });
        }
      });

      await repartidorDb.transaction(
        "rw",
        [repartidorDb.historial, repartidorDb.valoraciones],
        async () => {
          if (toDelete.length)    await repartidorDb.historial.bulkDelete(toDelete);
          if (toUpsert.length)    await repartidorDb.historial.bulkPut(toUpsert);
          if (toUpsertVal.length) await repartidorDb.valoraciones.bulkPut(toUpsertVal);
        }
      );

      await _computeStats();
    },
    (err) => console.error("[dbSync] Error sincronizando historial:", err)
  );

  unsubscribers.push(unsub);
}

// ── Cómputo de estadísticas ───────────────────────────────
// Lee historial de IndexedDB y escribe en store "estadisticas"

async function _computeStats() {
  try {
    const today     = new Date().toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);

    const [todayOrders, monthOrders, allOrders] = await Promise.all([
      repartidorDb.historial.where("dateKey").equals(today).toArray(),
      repartidorDb.historial.where("monthKey").equals(thisMonth).toArray(),
      repartidorDb.historial.toArray(),
    ]);

    const [todayVals, allVals] = await Promise.all([
      repartidorDb.valoraciones.where("dateKey").equals(today).toArray(),
      repartidorDb.valoraciones.toArray(),
    ]);

    const calcStats = (orders, vals) => {
      const completados = orders.filter((o) => o.status === "completed");
      const cancelados  = orders.filter((o) => o.status === "cancelled");
      const ganancias   = completados.reduce((s, o) => s + (o.earnings || 0), 0);
      const avgRating   = vals.length
        ? vals.reduce((s, v) => s + v.score, 0) / vals.length
        : null;

      return {
        pedidosCompletados: completados.length,
        pedidosCancelados:  cancelados.length,
        pedidosTotal:       orders.length,
        gananciaTotal:      ganancias,
        avgRating:          avgRating ? Number(avgRating.toFixed(2)) : null,
        valoraciones:       vals.length,
      };
    };

    await repartidorDb.estadisticas.bulkPut([
      { key: `hoy_${today}`,         dateKey:   today,      ...calcStats(todayOrders, todayVals) },
      { key: `mes_${thisMonth}`,      monthKey:  thisMonth,  ...calcStats(monthOrders, []) },
      { key: "total",                                        ...calcStats(allOrders,   allVals) },
    ]);
  } catch (err) {
    console.error("[dbSync] Error computando estadísticas:", err);
  }
}

// ── Helpers de lectura (para los componentes) ─────────────

export async function getProfile() {
  return repartidorDb.profile.get("me");
}

export async function getStatsHoy() {
  const today = new Date().toISOString().slice(0, 10);
  return repartidorDb.estadisticas.get(`hoy_${today}`);
}

export async function getStatsMes() {
  const thisMonth = new Date().toISOString().slice(0, 10).slice(0, 7);
  return repartidorDb.estadisticas.get(`mes_${thisMonth}`);
}

export async function getStatsTotal() {
  return repartidorDb.estadisticas.get("total");
}

export async function getHistorialReciente(limitN = 20) {
  return repartidorDb.historial
    .orderBy("createdAtMs")
    .reverse()
    .limit(limitN)
    .toArray();
}

export async function getValoraciones(limitN = 50) {
  return repartidorDb.valoraciones
    .orderBy("dateKey")
    .reverse()
    .limit(limitN)
    .toArray();
}
