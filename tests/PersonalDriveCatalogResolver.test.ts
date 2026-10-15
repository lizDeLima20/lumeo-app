import assert from "node:assert/strict";
import test from "node:test";
import { PersonalDriveCatalogResolver, driveThumbnailUrl } from "../src/services/PersonalDriveCatalogResolver";

const book = { id: "book-file", name: "O Livro.epub", mimeType: "application/epub+zip" };

test("maps legacy catalog metadata without rendering undefined synopsis", () => {
  const resolver = new PersonalDriveCatalogResolver({ books: [{ driveFileId: "book-file", title: "O Livro", author: "Autora", synopsis: "Sinopse íntegra", coverPath: "covers/capa.webp" }] },
    [book, { id: "cover-file", name: "capa.webp", mimeType: "image/webp" }]);
  assert.deepEqual(resolver.resolve(book), { title: "O Livro", author: "Autora", synopsis: "Sinopse íntegra", coverDriveFileId: "cover-file" });
});

test("uses summary then description and accepts catalog arrays", () => {
  const summary = new PersonalDriveCatalogResolver([{ bookPath: "books/O Livro.epub", summary: "Resumo", coverDriveFileId: "cover" }], [book]);
  assert.equal(summary.resolve(book)?.synopsis, "Resumo");
  assert.equal(driveThumbnailUrl("cover", book.id), "https://drive.google.com/thumbnail?id=cover&sz=w400");
  const description = new PersonalDriveCatalogResolver([{ title: "O Livro", description: "Descrição" }], [book]);
  assert.equal(description.resolve(book)?.synopsis, "Descrição");
});

test("rejects non-https external cover URL and does not use book path as cover", () => {
  const resolver = new PersonalDriveCatalogResolver([{ driveFileId: "book-file", coverUrl: "javascript:alert(1)", bookPath: "books/O Livro.epub" }], [book]);
  const value = resolver.resolve(book);
  assert.equal(value?.coverUrl, undefined); assert.equal(value?.coverDriveFileId, undefined);
});
