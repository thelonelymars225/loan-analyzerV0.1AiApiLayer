import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // The API (Fastify + Better Auth) runs on its own port in development. Proxying /api keeps
  // the browser on one origin, so the session cookie and server-sent events just work.
  const apiTarget = env.VITE_API_TARGET || "http://localhost:3000";

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: false },
      },
    },
    preview: {
      port: 4173,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: false },
      },
    },
  };
});
