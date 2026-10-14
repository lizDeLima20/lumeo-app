import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { EnvironmentConfig } from "../src/config/EnvironmentConfig";

describe("configuração Android Capacitor", () => {
  it("never accepts a BFF URL in the Android personal build", () => {
    const config = new EnvironmentConfig({ MODE: "android", VITE_APP_ENV: "production", VITE_CAPACITOR_API_URL: "https://lumeo-livros.vercel.app/api/" } as ImportMetaEnv, () => true).read();
    assert.equal(config.bffBaseUrl, "");
  });

  it("never resolves a catalogue endpoint for Android, even from a legacy env", () => {
    const config = new EnvironmentConfig({ MODE: "production", VITE_API_URL: "http://localhost:3000/api" } as ImportMetaEnv, () => true).read();
    assert.equal(config.bffBaseUrl, "");
    assert.notEqual(config.bffBaseUrl, "/api");
  });

  it("keeps same-origin API requests for the deployed Web frontend", () => {
    const config = new EnvironmentConfig({ MODE: "production", PROD: true } as ImportMetaEnv, () => false).read();
    assert.equal(config.bffBaseUrl, "/api");
  });
  it("keeps the launcher callback scoped to the Lumeo custom scheme", async () => {
    const manifest = await readFile("android/app/src/main/AndroidManifest.xml", "utf8");
    assert.match(manifest, /android:scheme="com\.lumeo\.reader"/);
    assert.match(manifest, /android:host="auth"/);
    assert.match(manifest, /android:pathPrefix="\/callback"/);
  });

  it("uses the official frontend mark in the Android launcher resources", async () => {
    const source = await readFile("public/icons/icon-512.png");
    const icon = await readFile("android/app/src/main/res/mipmap-mdpi/ic_launcher.png");
    assert.deepEqual(icon, source);
  });

  it("keeps Android runtime diagnostics free of session and secret values", async () => {
    const diagnostics = await readFile("src/platform/AndroidRuntimeDiagnostics.ts", "utf8");
    assert.doesNotMatch(diagnostics, /accessToken|refreshToken|secretKey|bearer\s+/i);
    assert.match(diagnostics, /LUMEO_ANDROID_PERSONAL_LIBRARY_READY/);
    assert.doesNotMatch(diagnostics, /fetch\(|BFF_READY|supabaseUrl/);
    assert.match(diagnostics, /JSON\.stringify/);
  });
});
