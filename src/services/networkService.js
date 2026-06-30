import { Network } from "@capacitor/network";

// Devuelve { connected: boolean, connectionType: 'wifi'|'cellular'|'none'|'unknown' }.
// En browser/desktop sin soporte nativo, asume conectado para no bloquear dev.
export async function getNetworkStatus() {
  try {
    return await Network.getStatus();
  } catch {
    return { connected: true, connectionType: "unknown" };
  }
}

// Registra un listener de cambios de conectividad. Devuelve el handle para
// poder cancelarlo con handle.remove() al desmontar.
export async function addNetworkListener(callback) {
  try {
    return await Network.addListener("networkStatusChange", callback);
  } catch {
    return { remove: () => {} };
  }
}
