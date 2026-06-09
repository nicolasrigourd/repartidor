import { getToken, onMessage } from "firebase/messaging";
import { doc, updateDoc } from "firebase/firestore";
import { messaging, db } from "../firebaseconfig";

const VAPID_KEY =
  "BEDzaIKrOaZmTFlQ_9zwjNyVAOwLFZJ-Q-xiOe6Oi_UNJhsTS-9PFn2RncLYmHHHvswEVdsuEPuTU-qnMwVMhdI";

async function getSwRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    await navigator.serviceWorker.register("/fcm-sw.js", { scope: "/" });
    // Espera a que el SW esté activo antes de pedir el token
    return await navigator.serviceWorker.ready;
  } catch (err) {
    console.error("[FCM] Error registrando service worker:", err);
    return null;
  }
}

export async function initNotifications(repartidorDocId) {
  if (!("Notification" in window)) return null;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    console.warn("[FCM] Permiso de notificaciones denegado.");
    return null;
  }

  const swRegistration = await getSwRegistration();
  if (!swRegistration) return null;

  try {
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swRegistration,
    });

    if (!token) {
      console.warn("[FCM] No se obtuvo token.");
      return null;
    }

    await updateDoc(doc(db, "repartidores", String(repartidorDocId)), {
      fcmToken:          token,
      fcmTokenUpdatedAt: new Date().toISOString(),
    });

    console.log("[FCM] Token registrado:", token);
    return token;
  } catch (err) {
    console.error("[FCM] Error obteniendo token:", err);
    return null;
  }
}

// Llama a onNotification(payload) cuando llega un mensaje con la app en foreground
export function listenForegroundMessages(onNotification) {
  return onMessage(messaging, (payload) => {
    console.log("[FCM] Mensaje en foreground:", payload);
    onNotification?.(payload);
  });
}
