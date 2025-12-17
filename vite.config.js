import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      strategies: "generateSW",
      includeAssets: ["favicon.ico", "apple-touch-icon.png"],
      manifest: {
        name: "Cadetería Repartidor",
        short_name: "Repartidor",
        description: "App PWA para repartidores de la cadetería",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#16a34a",
        background_color: "#020617",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    }),
  ],
});
