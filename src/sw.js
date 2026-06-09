import { clientsClaim } from "workbox-core";
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";

clientsClaim();

// Responde al prompt del PWA update (useRegisterSW envía SKIP_WAITING)
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Precaching PWA — vite-plugin-pwa inyecta el manifest aquí
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// FCM — mensajes cuando la app está en background o cerrada
const app = initializeApp({
  apiKey: "AIzaSyCc-QMneztyou0qbtnUnAp61ECGZtiAqjo",
  authDomain: "webappcadeteria.firebaseapp.com",
  projectId: "webappcadeteria",
  storageBucket: "webappcadeteria.firebasestorage.app",
  messagingSenderId: "918934733683",
  appId: "1:918934733683:web:d18ccd2d08fdbe2e7b7b06",
  databaseURL: "https://webappcadeteria-default-rtdb.firebaseio.com",
});

const messagingSW = getMessaging(app);

onBackgroundMessage(messagingSW, (payload) => {
  self.registration.showNotification(
    payload?.notification?.title || "Nuevo mensaje",
    {
      body:  payload?.notification?.body || "",
      icon:  "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      data:  payload?.data || {},
    }
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          try { await client.navigate(url); } catch {}
          return;
        }
      }

      await clients.openWindow(url);
    })()
  );
});
