import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const configDir = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const clientEnv = loadEnv(mode, configDir, "");
  const functionsEnv = loadEnv(mode, path.resolve(configDir, "../functions"), "");

  return {
    plugins: [react(), tailwindcss()],
    define: {
      "import.meta.env.VITE_GOOGLE_CALENDAR_CLIENT_ID": JSON.stringify(
        clientEnv.VITE_GOOGLE_CALENDAR_CLIENT_ID || functionsEnv.GOOGLE_CALENDAR_CLIENT_ID || ""
      ),
      "import.meta.env.VITE_GOOGLE_CALENDAR_REDIRECT_URI": JSON.stringify(
        clientEnv.VITE_GOOGLE_CALENDAR_REDIRECT_URI || functionsEnv.GOOGLE_CALENDAR_REDIRECT_URI || ""
      ),
    },
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:5002",
          changeOrigin: true,
          rewrite: (pathValue) =>
            pathValue.replace(/^\/api/, "/q-doc-challenge/us-central1/api"),
        },
      },
    },
  };
});

