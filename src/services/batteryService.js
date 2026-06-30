import { Device } from "@capacitor/device";

export const LOW_BATTERY_THRESHOLD = 20;

// level: 0-100 (entero) o null si no se pudo leer (ej. navegador de
// escritorio sin soporte nativo de batería).
export async function getBatteryInfo() {
  try {
    const info = await Device.getBatteryInfo();
    if (info?.batteryLevel == null) return { level: null, isCharging: false };
    return {
      level: Math.round(info.batteryLevel * 100),
      isCharging: info.isCharging === true,
    };
  } catch {
    return { level: null, isCharging: false };
  }
}

export function isBatteryCritical({ level, isCharging }) {
  return level != null && level <= LOW_BATTERY_THRESHOLD && !isCharging;
}
