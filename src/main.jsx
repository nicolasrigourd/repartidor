import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// ✅ PWA register (vite-plugin-pwa)
import { registerSW } from "virtual:pwa-register";

registerSW({
  immediate: true,
});

// ✅ Firebase Cloud Messaging SW (background push)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      console.log("✅ Firebase messaging SW registrado");
    } catch (e) {
      console.error("❌ Error registrando firebase-messaging-sw.js", e);
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
