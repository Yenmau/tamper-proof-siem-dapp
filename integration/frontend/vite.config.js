import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/data": {
        target: "http://127.0.0.1:8088",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/data/, ""),
      },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
