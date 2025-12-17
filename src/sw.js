/* eslint-disable no-undef */
import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";

const firebaseConfig = {
  apiKey: "AIzaSyCc-QMneztyou0qbtnUnAp61ECGZtiAqjo",
  authDomain: "webappcadeteria.firebaseapp.com",
  projectId: "webappcadeteria",
  storageBucket: "webappcadeteria.firebasestorage.app",
  messagingSenderId: "918934733683",
  appId: "1:918934733683:web:d18ccd2d08fdbe2e7b7b06",
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

onBackgroundMessage(messaging, (payload) => {
  self.registration.showNotification(
    payload?.notification?.title || "Nuevo pedido",
    {
      body: payload?.notification?.body || "Te llegó un pedido",
      icon: "/pwa-192x192.png",
      data: payload?.data || {},
    }
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";
  event.waitUntil(clients.openWindow(url));
});
