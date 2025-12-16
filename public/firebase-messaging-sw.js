/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

// ⚠️ MISMA config que tu firebaseConfig
firebase.initializeApp({
  apiKey: "AIzaSyCc-QMneztyou0qbtnUnAp61ECGZtiAqjo",
  authDomain: "webappcadeteria.firebaseapp.com",
  projectId: "webappcadeteria",
  storageBucket: "webappcadeteria.firebasestorage.app",
  messagingSenderId: "918934733683",
  appId: "1:918934733683:web:d18ccd2d08fdbe2e7b7b06",
});

const messaging = firebase.messaging();

// Background push (cuando está minimizada/cerrada)
messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Nuevo pedido";
  const body = payload?.notification?.body || "Te llegó una oferta de pedido";
  const data = payload?.data || {};

  self.registration.showNotification(title, {
    body,
    icon: "/pwa-192x192.png",   // ajustá a tus icons reales
    badge: "/pwa-192x192.png",
    data, // importante: para abrir la app con contexto
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return clients.openWindow("/");
    })
  );
});
