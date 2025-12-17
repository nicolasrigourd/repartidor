/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js");

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
  self.registration.showNotification(payload?.notification?.title || "Nuevo pedido", {
    body: payload?.notification?.body || "Te llegó un pedido",
    icon: "/pwa-192x192.png",
    data: payload?.data || {},
  });
});
