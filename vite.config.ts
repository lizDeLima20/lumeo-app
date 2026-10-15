import { defineConfig } from "vite";

/**
 * Lumeo's Android bundle is a personal, offline-first library.  It speaks to
 * Google Drive directly after native consent and deliberately has no /api
 * proxy: a WebView must never turn a relative request into an accidental
 * dependency on a local or Vercel BFF.
 */
export default defineConfig({
  // Android System WebView on supported devices does not consistently parse
  // newer assignment operators such as `??=`. Keep the offline bundle at a
  // conservative syntax level; this affects transpilation only, not reader
  // or balloon-recognition behaviour.
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        // PDF.js currently references the ECMAScript Iterator global. Android
        // WebView 83 (present on the G7max test device) predates it. Define
        // only the standard iterator prototype when the platform has none.
        intro: `if (typeof globalThis.Iterator === "undefined") {
  const lumeoIteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  globalThis.Iterator = function Iterator() {};
  globalThis.Iterator.prototype = lumeoIteratorPrototype;
}
if (typeof Element !== "undefined" && !Element.prototype.replaceChildren) {
  const lumeoReplaceChildren = function (...children) {
    while (this.firstChild) this.removeChild(this.firstChild);
    for (const child of children) this.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  };
  Element.prototype.replaceChildren = lumeoReplaceChildren;
  if (typeof DocumentFragment !== "undefined") DocumentFragment.prototype.replaceChildren = lumeoReplaceChildren;
  if (typeof Document !== "undefined") Document.prototype.replaceChildren = lumeoReplaceChildren;
}`,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
