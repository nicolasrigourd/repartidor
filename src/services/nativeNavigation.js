import { Capacitor } from "@capacitor/core";
import { AppLauncher } from "@capacitor/app-launcher";

function buildCandidates({ lat, lng }) {
  const dest = `${lat},${lng}`;
  const platform = Capacitor.getPlatform();
  const web = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;

  if (platform === "android") {
    return [`google.navigation:q=${dest}&mode=d`, `geo:${dest}?q=${dest}`, web];
  }

  if (platform === "ios") {
    return [
      `comgooglemaps://?daddr=${dest}&directionsmode=driving`,
      `http://maps.apple.com/?daddr=${dest}&dirflg=d`,
      web,
    ];
  }

  return [web];
}

// Lleva al repartidor a Maps en modo navegación turn-by-turn nativo.
// Recorre las URLs candidatas en orden (app nativa → esquema genérico →
// web) y abre la primera que el dispositivo pueda manejar.
export async function openNativeNavigation({ lat, lng, address }) {
  if (lat == null || lng == null) {
    if (address) {
      window.open(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
        "_blank",
        "noopener,noreferrer"
      );
    }
    return;
  }

  const candidates = buildCandidates({ lat, lng });
  const isNative = Capacitor.isNativePlatform();

  if (isNative) {
    for (const url of candidates) {
      try {
        const { value: canOpen } = await AppLauncher.canOpenUrl({ url });
        if (canOpen) {
          await AppLauncher.openUrl({ url });
          return;
        }
      } catch {
        // probamos la siguiente candidata
      }
    }
  }

  window.open(candidates[candidates.length - 1], "_blank", "noopener,noreferrer");
}
