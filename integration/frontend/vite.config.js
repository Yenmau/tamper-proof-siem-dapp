import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Saat `npm run dev`, folder /data (batch + artefak bukti) disajikan server
    // statis lain (mis. `python -m http.server 8088` di folder batch). Prefiks
    // /data dibuang dulu supaya path-nya sama seperti di nginx (alias /data/).
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
