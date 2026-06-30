import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebaseconfig";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Edición directa — sin aprobación de admin.

export async function updateCashOnHand(repartidorId, { cashOnHand, cashInAccount }) {
  if (!repartidorId) return;
  await updateDoc(doc(db, "repartidores", String(repartidorId)), {
    cashOnHand: num(cashOnHand),
    cashInAccount: num(cashInAccount),
    updatedAt: serverTimestamp(),
  });
}

export async function updateHasThermalBag(repartidorId, hasThermalBag) {
  if (!repartidorId) return;
  await updateDoc(doc(db, "repartidores", String(repartidorId)), {
    hasThermalBag: hasThermalBag === true,
    updatedAt: serverTimestamp(),
  });
}

// Solicitudes — quedan pendientes hasta que un admin las apruebe desde Panel Admin.

export async function requestVehicleChange(repartidorId, vehicleType) {
  if (!repartidorId || !vehicleType) return;
  await updateDoc(doc(db, "repartidores", String(repartidorId)), {
    pendingVehicleType: vehicleType,
    vehicleChangeRequestedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function requestMercadoPagoChange(repartidorId, { alias, cvu }) {
  if (!repartidorId) return;
  await updateDoc(doc(db, "repartidores", String(repartidorId)), {
    pendingPaymentMpAlias: String(alias || "").trim(),
    pendingPaymentMpCvu: String(cvu || "").trim(),
    paymentChangeRequestedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
