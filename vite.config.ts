import { defineConfig } from "vite";

/**
 * Lumeo's Android bundle is a personal, offline-first library.  It speaks to
 * Google Drive directly after native consent and deliberately has no /api
 * proxy: a WebView must never turn a relative request into an accidental
 * dependency on a local or Vercel BFF.
 */
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
});
