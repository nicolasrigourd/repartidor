import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseconfig";
import { repartidorDb } from "../db/repartidorDb";

const COLLECTION = "pagosBase";

function generarPagoId(fecha, repartidorId) {
  return `pago_${fecha}_${String(repartidorId)}_${Date.now()}`;
}

function formatFecha(date = new Date()) {
  const y  = date.getFullYear();
  const m  = String(date.getMonth() + 1).padStart(2, "0");
  const d  = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Descuenta el pago de deuda primero, luego multa
function calcularImputacion({ monto, deudaActual, multaActual }) {
  let restante = num(monto);
  let deuda    = num(deudaActual);
  let multa    = num(multaActual);

  const aplicadoADeuda = Math.min(deuda, restante);
  deuda   -= aplicadoADeuda;
  restante -= aplicadoADeuda;

  const aplicadoAMulta = Math.min(multa, restante);
  multa   -= aplicadoAMulta;
  restante -= aplicadoAMulta;

  return {
    currentDebt:    Math.max(0, deuda),
    currentFine:    Math.max(0, multa),
    aplicadoADeuda,
    aplicadoAMulta,
    excedente:      Math.max(0, restante),
  };
}

export async function registrarPagoSimulado({ repartidorId, deuda, multa }) {
  const monto = num(deuda) + num(multa);
  if (monto <= 0) return { ok: false, message: "No hay monto a pagar." };

  const now            = new Date();
  const fecha          = formatFecha(now);
  const createdAtLocal = now.toISOString();
  const hora           = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  const pagoId         = generarPagoId(fecha, repartidorId);

  const imputacion = calcularImputacion({ monto, deudaActual: deuda, multaActual: multa });

  const pago = {
    id:     pagoId,
    pagoId,
    fecha,

    repartidorId: String(repartidorId),
    monto,
    hora,
    tipoPago: "mercadopago",

    // Schema universal Cadev2
    forma:       "mercadopago",
    concepto:    "base_deuda",
    comprobante: "",
    observacion: "",

    origenPago:     "online",
    source:         "driver_app",
    visibleEnLocal: false,

    operadorId:     "",
    operadorNombre: "Repartidor",

    // Snapshots de deuda al momento del pago
    deudaSnapshot: num(deuda),
    multaSnapshot: num(multa),
    baseSnapshot:  0,

    // Imputación
    aplicadoADeuda: imputacion.aplicadoADeuda,
    aplicadoAMulta: imputacion.aplicadoAMulta,
    aplicadoABase:  0,
    excedente:      imputacion.excedente,

    imputacionLocal: {
      criterio:              "deuda_multa",
      aplicadoADeuda:        imputacion.aplicadoADeuda,
      aplicadoAMulta:        imputacion.aplicadoAMulta,
      aplicadoABase:         0,
      excedente:             imputacion.excedente,
      baseActualNoModificada: true,
      baseDiariaNoModificada: true,
      appliedAtLocal:        createdAtLocal,
    },

    estado:     "confirmado",
    syncStatus: "pending",
    syncError:  "",

    createdAt:       createdAtLocal,
    createdAtLocal,
    updatedAtLocal:  createdAtLocal,
    createdAtServer: null,
    updatedAtServer: null,
  };

  // 1. Guardar en IndexedDB offline-first
  await repartidorDb.pagos.put(pago);

  // 2. Actualizar profile en IndexedDB optimistamente
  await repartidorDb.profile
    .where("_key").equals("me")
    .modify({
      currentDebt: imputacion.currentDebt,
      currentFine: imputacion.currentFine,
      deudaActual: imputacion.currentDebt,
      multaActual: imputacion.currentFine,
    })
    .catch(() => {});

  // 3. Subir a Firestore pagosBase/{pagoId} (best-effort)
  try {
    const pagoFirestore = {
      ...pago,
      syncStatus:      "synced",
      syncError:       "",
      createdAtServer: serverTimestamp(),
      updatedAtServer: serverTimestamp(),
    };
    await setDoc(doc(db, COLLECTION, pagoId), pagoFirestore, { merge: true });
    await repartidorDb.pagos.update(pagoId, { syncStatus: "synced", updatedAtLocal: new Date().toISOString() });
  } catch (err) {
    console.error("[pagosBase] Error subiendo pago a Firestore:", err);
    await repartidorDb.pagos.update(pagoId, {
      syncStatus:    "error",
      syncError:     err?.message || "No se pudo sincronizar.",
      updatedAtLocal: new Date().toISOString(),
    }).catch(() => {});
  }

  // 4. Zeroing deuda/multa en repartidores/{id} (best-effort)
  try {
    await updateDoc(doc(db, "repartidores", String(repartidorId)), {
      currentDebt: imputacion.currentDebt,
      currentFine: imputacion.currentFine,
    });
  } catch (err) {
    console.error("[pagosBase] Error actualizando deuda en repartidor:", err);
  }

  return { ok: true, pago, imputacion };
}
