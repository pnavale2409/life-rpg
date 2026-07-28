import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT: change "base" to match your GitHub repo name, e.g. "/life-rpg/"
// This must match exactly (including slashes) or GitHub Pages will 404 on assets.
export default defineConfig({
  plugins: [react()],
  base: "/life-rpg/",
});
