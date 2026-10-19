import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PersonalDriveCoverResolver } from "../src/services/PersonalDriveCoverResolver";
import type { GoogleDriveLibraryEntry } from "../src/external/GoogleDriveLibraryRepository";

const view = () => readFileSync("src/views/PersonalDriveLibraryView.ts", "utf8");
const entry = (id: string): GoogleDriveLibraryEntry => ({ sourceId: "s", fileId: id, name: `${id}.pdf`, mimeType: "application/pdf", genre: "Humor", thumbnailUrl: "", modifiedTime: "2024-01-01T00:00:00Z", size: "100" });

describe("capas da Explorar: rápidas durante a sincronização", () => {
  it("a página que a sincronização acrescenta não recria os cards nem cancela as capas", () => {
    const source = view();
    assert.match(source, /\{ drawFilters\(\); drawGrid\(true\); \}/, "o redesenho da sincronização mantém os cards");
    assert.match(source, /if \(!fromSync\) resetCovers\(\);/);
    assert.match(source, /if \(same\?\.key === key\) return same\.card;/, "o mesmo card volta, com a capa já carregada");
    assert.match(source, /coverObserver\?\.disconnect\(\); kept = new Map\(\);/, "trocar de gênero, pasta ou busca começa do zero");
  });

  it("capa de catálogo só é pedida ao servidor de imagens quando o card chega perto da tela", () => {
    const source = view();
    assert.match(source, /const remote = Boolean\(initial && \/\^https\?:\/i\.test\(initial\) && coverObserver\);/);
    assert.match(source, /if \(initial\) \{ coverObserver\?\.unobserve\(card\); showRealCover\(initial\); return; \}/);
  });

  it("capa já salva no aparelho não espera na fila das capas que vêm da rede", async () => {
    let releaseNetwork: () => void = () => undefined;
    const network = new Promise<void>(resolve => { releaseNetwork = resolve; });
    const saved = new Map([[PersonalDriveCoverResolver.key(entry("cached")), "data:image/webp;base64,AAAA"]]);
    const resolver = new PersonalDriveCoverResolver({
      drive: { range: async () => { await network; throw new Error("offline"); }, thumbnailLink: async () => { await network; return null; } },
      cache: { get: async key => saved.get(key) ?? null, save: async () => undefined },
      localFile: async () => null, firstPage: async () => null, thumbnail: async () => "data:image/webp;base64,BBBB",
    });
    // Three slow network covers fill the queue first.
    const slow = ["a", "b", "c", "d"].map(id => resolver.resolve(entry(id)));
    const fast = await Promise.race([resolver.resolve(entry("cached")), new Promise<string>(resolve => setTimeout(() => resolve("waited"), 200))]);
    assert.equal(fast, "data:image/webp;base64,AAAA");
    releaseNetwork(); await Promise.all(slow);
  });
});
