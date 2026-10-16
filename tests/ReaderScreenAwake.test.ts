import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ReaderScreenAwake } from "../src/services/ReaderScreenAwake";

describe("a tela não apaga com um livro ou uma HQ aberta", () => {
  it("os dois leitores pedem a tela acesa ao abrir e a liberam ao fechar", () => {
    for (const path of ["src/views/ReaderView.ts", "src/views/ComicReaderView.ts"]) {
      const source = readFileSync(path, "utf8");
      const render = source.slice(source.indexOf("public render()"), source.indexOf("public override unmount()"));
      const unmount = source.slice(source.indexOf("public override unmount()"));
      assert.match(render, /ReaderScreenAwake\.keep\(\)/, `${path}: keep ao abrir`);
      assert.match(unmount.slice(0, 900), /ReaderScreenAwake\.release\(\)/, `${path}: release ao fechar`);
    }
  });

  it("no Android é a flag da própria janela, registrada no app, sem configuração do sistema", () => {
    const plugin = readFileSync("android/app/src/main/java/com/lumeo/reader/ReaderAwakePlugin.java", "utf8");
    assert.match(plugin, /addFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/);
    assert.match(plugin, /clearFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/);
    assert.doesNotMatch(plugin, /Settings\.System|WakeLock|WAKE_LOCK/);
    assert.match(readFileSync("android/app/src/main/java/com/lumeo/reader/MainActivity.java", "utf8"), /registerPlugin\(ReaderAwakePlugin\.class\)/);
  });

  it("no navegador usa o wake lock da tela e o solta ao fechar", async () => {
    const calls: string[] = [];
    const lock = { released: false, release: async () => { lock.released = true; calls.push("release"); } };
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { wakeLock: { request: async (type: string) => { calls.push(`request:${type}`); return lock; } } } });
    try {
      await ReaderScreenAwake.keep();
      await ReaderScreenAwake.keep(); // already held: not asked twice
      await ReaderScreenAwake.release();
      assert.deepEqual(calls, ["request:screen", "release"]);
    } finally { if (original) Object.defineProperty(globalThis, "navigator", original); else delete (globalThis as { navigator?: unknown }).navigator; }
  });
});
