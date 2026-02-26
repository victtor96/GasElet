import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/backend": {
        target: "http://192.168.0.203:7080",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/backend/, ""),
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
