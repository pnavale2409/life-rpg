import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/life-rpg/",

  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",

      manifest: {
        name: "Life RPG",
        short_name: "Life RPG",
        description: "Gamify your self-improvement journey",

        theme_color: "#111827",
        background_color: "#111827",

        display: "standalone",
        orientation: "portrait",

        start_url: "/life-rpg/",
        scope: "/life-rpg/",

        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
});
