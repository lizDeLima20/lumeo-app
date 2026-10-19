import assert from "node:assert/strict";
import { it } from "node:test";
import { collectionsFromDrive, naturalChapterOrder } from "../src/audiobooks/AudiobookLibrary";
import { isReadableForSource } from "../src/services/PersonalDriveLibraryService";
import { queuedNext, queuedPrevious } from "../src/audiobooks/AudiobookPlayer";

it("lista somente formatos de áudio na fonte Audiolivros", () => {
  for (const name of ["01.mp3", "02.m4a", "03.aac", "04.ogg", "05.opus", "06.wav"]) assert.equal(isReadableForSource(name, "audiobook"), true);
  assert.equal(isReadableForSource("livro.pdf", "audiobook"), false);
  assert.equal(isReadableForSource("livro.mp3", "book"), false);
});

it("avança e volta na fila sem baixar capítulos fora da ação do usuário", () => {
  const queue = ["1", "2", "3"].map(id => ({ id, sourceId: "s", fileId: id, name: `${id}.mp3`, title: id, mimeType: "audio/mpeg", collection: "Coleção", folderPath: [] }));
  assert.equal(queuedNext(queue, "1")?.id, "2"); assert.equal(queuedNext(queue, "3"), undefined);
  assert.equal(queuedPrevious(queue, "3")?.id, "2"); assert.equal(queuedPrevious(queue, "1"), undefined);
});

it("preserva pasta raiz como coleção e ordena capítulos naturalmente", () => {
  const sources = [{ id: "s", userId: "personal", name: "Saga", driveName: "Saga", folderUrl: "https://drive.google.com/drive/folders/s", folderId: "s", contentType: "audiobook" as const, createdAt: "x", updatedAt: "x" }];
  const entries = [
    { sourceId: "s", fileId: "10", name: "Capítulo 10.mp3", mimeType: "audio/mpeg", genre: "Saga", thumbnailUrl: "", contentType: "audiobook" as const, collectionPath: ["Volume 2"] },
    { sourceId: "s", fileId: "2", name: "Capítulo 2.mp3", mimeType: "audio/mpeg", genre: "Saga", thumbnailUrl: "", contentType: "audiobook" as const, collectionPath: ["Volume 1"] },
  ];
  const collections = collectionsFromDrive(sources, entries);
  assert.equal(collections.length, 1); assert.equal(collections[0]?.title, "Saga");
  assert.deepEqual(collections[0]?.chapters.map(value => value.name), ["Capítulo 2.mp3", "Capítulo 10.mp3"]);
  assert.ok(naturalChapterOrder(collections[0]!.chapters[0]!, collections[0]!.chapters[1]!) < 0);
});
