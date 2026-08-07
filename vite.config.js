import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Vite binds to 0.0.0.0 so the app is reachable from another device, but on
    // a machine with Hyper-V / virtual adapters the HMR client then guesses the
    // wrong address and the websocket never connects. Pinning the HMR endpoint
    // to localhost keeps hot reload working regardless of how many NICs exist.
    hmr: {
      host: "localhost",
      protocol: "ws",
      clientPort: 5173
    },
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true
      },
      // Generated artifacts (thumbnails, clips, frames) are served straight off disk.
      "/files": {
        target: "http://localhost:8787",
        changeOrigin: true
      }
    }
  }
});
