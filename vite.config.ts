import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Android is an offline-first personal library. It must never require a BFF URL
  // merely to package the local reader and its Google Drive OAuth flow.
  return {
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3000",
          changeOrigin: false,
        },
      },
    },
  };
});
