/* public/fcm-sw.js */
/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCc-QMneztyou0qbtnUnAp61ECGZtiAqjo",
  authDomain: "webappcadeteria.firebaseapp.com",
  projectId: "webappcadeteria",
  storageBucket: "webappcadeteria.firebasestorage.app",
  messagingSenderId: "918934733683",
  appId: "1:918934733683:web:d18ccd2d08fdbe2e7b7b06",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Nuevo pedido";
  const url =
    payload?.data?.url ||
    payload?.fcmOptions?.link ||
    payload?.notification?.click_action ||
    "/";

  const options = {
    body: payload?.notification?.body || "Te llegó un pedido",
    icon: "/pwa-192x192.png",
    data: { url },
  };

  self.registration.showNotification(title, options);
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

      // si ya hay una ventana abierta de la PWA, la enfocamos
      for (const client of allClients) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          try {
            await client.navigate(url);
          } catch {}
          return;
        }
      }

      // si no hay, abrimos
      await clients.openWindow(url);
    })()
  );
});
