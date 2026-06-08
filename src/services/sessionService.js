import { repartidorDb } from "../db/repartidorDb";

const SESSION_KEY = "session";

export async function saveSession(user) {
  if (!user) return;
  await repartidorDb.config.put({ key: SESSION_KEY, value: JSON.stringify(user) });
}

export async function getSession() {
  try {
    const record = await repartidorDb.config.get(SESSION_KEY);
    if (!record?.value) return null;
    return JSON.parse(record.value);
  } catch {
    return null;
  }
}

export async function clearSession() {
  await repartidorDb.config.delete(SESSION_KEY).catch(() => {});
}
