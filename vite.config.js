import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
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
