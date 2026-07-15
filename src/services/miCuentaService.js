import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseconfig";
import { repartidorDb } from "../db/repartidorDb";

const COLLECTION = "dailyBase";

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ultimosDateKeys(dias) {
  const hoy = new Date();
  const keys = [];
  for (let i = 1; i <= dias; i++) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - i);
    keys.push(toDateKey(d));
  }
  return keys;
}

// Un día cerrado nunca cambia — se lee de Firestore una sola vez en la vida
// y se cachea para siempre en IndexedDB. Solo guarda la fila del propio
// repartidor, no el doc completo (evita guardar en el dispositivo los
// datos de deuda de otros repartidores).
async function obtenerDia(dateKey, { driverId, sucursal }) {
  const cached = await repartidorDb.historialBase.get(dateKey);
  if (cached) return cached.sinDatos ? null : cached;

  try {
    const snap = await getDoc(doc(db, COLLECTION, `${dateKey}_${sucursal || "central"}`));

    if (!snap.exists()) {
      await repartidorDb.historialBase.put({ dateKey, sinDatos: true });
      return null;
    }

    const fila = (snap.data()?.filas || []).find(
      (f) => String(f?.driverId || "") === String(driverId)
    );

    if (!fila) {
      await repartidorDb.historialBase.put({ dateKey, sinDatos: true });
      return null;
    }

    const registro = { dateKey, ...fila };
    await repartidorDb.historialBase.put(registro);
    return registro;
  } catch (err) {
    console.error("[miCuentaService] Error leyendo dailyBase:", dateKey, err);
    return null;
  }
}

export async function getHistorialBase({ driverId, sucursal, dias = 7 }) {
  if (!driverId) return [];

  const dateKeys = ultimosDateKeys(dias);
  const dias_ = await Promise.all(
    dateKeys.map((dateKey) => obtenerDia(dateKey, { driverId, sucursal }))
  );

  return dias_
    .filter(Boolean)
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
}
