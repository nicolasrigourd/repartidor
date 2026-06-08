import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseconfig";
import { repartidorDb } from "../db/repartidorDb";

function generateId() {
  return `pago_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function registrarPagoSimulado({ repartidorId, deuda, multa }) {
  const total = Number(deuda || 0) + Number(multa || 0);
  if (total <= 0) return { ok: false, message: "No hay monto a pagar." };

  const id      = generateId();
  const dateKey = new Date().toISOString().slice(0, 10);
  const createdAtMs = Date.now();

  const pago = {
    id,
    repartidorId: String(repartidorId),
    deuda:        Number(deuda || 0),
    multa:        Number(multa || 0),
    monto:        total,
    metodo:       "mercadopago_simulado",
    estado:       "completado",
    dateKey,
    createdAtMs,
    syncStatus:   "pending",
  };

  // 1. Guardar en IndexedDB offline-first
  await repartidorDb.pagos.put(pago);

  // 2. Actualizar IndexedDB profile optimistamente (no esperar a Firestore)
  await repartidorDb.profile
    .where("_key").equals("me")
    .modify({ currentDebt: 0, currentFine: 0, deudaActual: 0, multaActual: 0 })
    .catch(() => {});

  // 3. Subir pago a Firestore pagos/{id} (best-effort)
  try {
    await setDoc(doc(db, "pagos", id), {
      ...pago,
      syncStatus: "synced",
      createdAt:  serverTimestamp(),
    });
    await repartidorDb.pagos.update(id, { syncStatus: "synced" });
  } catch (err) {
    console.error("[pagos] Error subiendo pago a Firestore:", err);
  }

  // 4. Zeroing deuda/multa en repartidores/{id} (best-effort)
  try {
    await updateDoc(doc(db, "repartidores", String(repartidorId)), {
      currentDebt: 0,
      currentFine: 0,
    });
  } catch (err) {
    console.error("[pagos] Error actualizando deuda en repartidor:", err);
  }

  return { ok: true };
}
