import type { RangeReader } from "./CbzRangeCover";

/**
 * First page of a CBR (RAR4 or RAR5) read by byte ranges. A RAR has no central directory:
 * its file headers sit one after the other, each followed by its packed data. The walk reads
 * only the headers (jumping over the data), picks the first page in natural order, and builds
 * a one-file archive - the archive's own signature and main header, that file's header and
 * packed data, and an end block - which the comic reader's libarchive decodes like any CBR.
 *
 * Measured on the reference Drive folder: a 31-page, 11 MB CBR needs 33 small requests and
 * about 4% of the file when walked whole; an archive stored in page order stops after four
 * pages (about 7 requests). Solid, encrypted or multi-volume archives cannot be cut this way and
 * return null (their cover waits for the downloaded file).
 */
export interface RarEntry { name: string; headerOffset: number; headerSize: number; packedSize: number; dataOffset: number; }
export interface RarPlan { version: 4 | 5; prefix: Uint8Array; entries: RarEntry[]; }

const RAR4 = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00], RAR5 = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];
const IMAGE = /\.(jpe?g|png|webp|gif|bmp)$/i;
const HEADER_WINDOW = 512;
const MAX_ENTRIES = 3000;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
/** Each header costs a request, so the walk stops once this many pages came in natural order:
 *  the archive is then stored sorted and its first page is already known. */
const ORDERED_PAGES_TO_STOP = 4;

export async function planRar(read: RangeReader, totalSize: number): Promise<RarPlan | null> {
  const head = await read(0, Math.min(totalSize - 1, 7 + HEADER_WINDOW - 1));
  if (starts(head, RAR5)) return planRar5(read, totalSize, head);
  if (starts(head, RAR4)) return planRar4(read, totalSize, head);
  return null;
}

const isPage = (name: string): boolean => IMAGE.test(name) && !/(^|[\\/])(__MACOSX|\.)/.test(name);
const natural = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const lexical = (a: string, b: string): number => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };

/** Watches the walk: true once enough pages came sorted - in natural order, or in the plain
 *  name order archivers on Windows store ("1, 10, 11, 2"), whose first page is the same. A
 *  page out of both orders means the archive is not sorted, and then it is walked whole. */
function orderWatch(): (entry: RarEntry) => boolean {
  let last: string | null = null, count = 0, byNatural = true, byName = true;
  return entry => {
    if ((!byNatural && !byName) || !isPage(entry.name) || entry.packedSize <= 0) return false;
    if (last !== null) { byNatural &&= natural(last, entry.name) <= 0; byName &&= lexical(last, entry.name) <= 0; }
    if (!byNatural && !byName) return false;
    last = entry.name; return ++count >= ORDERED_PAGES_TO_STOP;
  };
}

/** The comic's first page: first image in natural order, ignoring hidden files. */
export function firstRarPage(plan: RarPlan): RarEntry | null {
  const pages = plan.entries.filter(entry => isPage(entry.name) && entry.packedSize > 0);
  pages.sort((a, b) => natural(a.name, b.name));
  return pages[0] ?? null;
}

/** A valid one-file archive holding only `entry`. */
export async function miniRar(read: RangeReader, plan: RarPlan, entry: RarEntry): Promise<Blob> {
  if (entry.packedSize > MAX_PAGE_BYTES) throw new Error("CBR_PAGE_TOO_LARGE");
  const body = await read(entry.headerOffset, entry.dataOffset + entry.packedSize - 1);
  const end = plan.version === 4 ? new Uint8Array([0xc4, 0x3d, 0x7b, 0x00, 0x40, 0x07, 0x00]) : rar5EndBlock();
  return new Blob([plan.prefix, body, end].map(part => new Uint8Array(part)), { type: "application/x-cbr" });
}

/** Walk, pick, cut: the whole ranged read. Null when the archive cannot be cut. */
export async function cbrCoverArchiveByRange(read: RangeReader, totalSize: number): Promise<Blob | null> {
  const plan = await planRar(read, totalSize);
  const page = plan ? firstRarPage(plan) : null;
  if (plan) console.info(JSON.stringify({ event: "CBR_RANGE_WALK", version: plan.version, entriesWalked: plan.entries.length, first: plan.entries.slice(0, 5).map(entry => entry.name.slice(-40)), page: page?.name.slice(-40) ?? null }));
  return plan && page ? miniRar(read, plan, page) : null;
}

async function planRar4(read: RangeReader, total: number, head: Uint8Array): Promise<RarPlan | null> {
  const view = dv(head);
  const mainFlags = view.getUint16(7 + 3, true), mainSize = view.getUint16(7 + 5, true);
  if (view.getUint8(7 + 2) !== 0x73) throw new Error("CBR_BAD_MAIN_HEADER");
  // Encrypted headers, solid compression or a multi-volume set: a page cannot be cut alone.
  if (mainFlags & 0x80 || mainFlags & 0x08 || mainFlags & 0x01) return null;
  const prefix = (await read(0, 7 + mainSize - 1)).slice();
  const entries: RarEntry[] = [], enough = orderWatch();
  for (let offset = 7 + mainSize; offset + 7 <= total && entries.length < MAX_ENTRIES;) {
    let block = await read(offset, Math.min(total - 1, offset + HEADER_WINDOW - 1)); let bv = dv(block);
    const type = bv.getUint8(2), flags = bv.getUint16(3, true), size = bv.getUint16(5, true);
    if (size < 7) break;
    if (block.length < size) { block = await read(offset, offset + size - 1); bv = dv(block); }
    let skip = 0;
    if (type === 0x74) {
      let packed = bv.getUint32(7, true); const nameSize = bv.getUint16(26, true); let at = 32;
      if (flags & 0x100) { packed += bv.getUint32(at, true) * 2 ** 32; at += 8; }
      if (flags & 0x04 || flags & 0x01 || flags & 0x02) return null;      // encrypted or split file
      const raw = block.subarray(at, at + nameSize), zero = raw.indexOf(0);
      const name = new TextDecoder("utf-8").decode(zero >= 0 ? raw.subarray(0, zero) : raw);
      entries.push({ name, headerOffset: offset, headerSize: size, packedSize: packed, dataOffset: offset + size });
      if (enough(entries[entries.length - 1]!)) break;
      skip = packed;
    } else if (type === 0x7b) break;
    else if (flags & 0x8000) skip = bv.getUint32(7, true);
    offset += size + skip;
  }
  return { version: 4, prefix, entries };
}

async function planRar5(read: RangeReader, total: number, head: Uint8Array): Promise<RarPlan | null> {
  const signature = 8;
  const main = parseRar5Block(head, signature);
  if (!main || main.type !== 1) {
    if (main?.type === 4) return null;                       // archive encryption header
    throw new Error("CBR_BAD_MAIN_HEADER");
  }
  const archiveFlags = readVint(head, main.fieldsAt).value;
  if (archiveFlags & 0x1 || archiveFlags & 0x4) return null; // multi-volume or solid
  const prefix = (await read(0, main.end - 1)).slice();
  const entries: RarEntry[] = [], enough = orderWatch();
  for (let offset = main.end; offset + 7 <= total && entries.length < MAX_ENTRIES;) {
    let window = await read(offset, Math.min(total - 1, offset + HEADER_WINDOW - 1));
    let block = parseRar5Block(window, 0);
    if (!block) break;
    if (block.end > window.length) { window = await read(offset, offset + block.end - 1); block = parseRar5Block(window, 0)!; }
    if (block.type === 5) break;                               // end of archive
    if (block.type === 2) {
      let at = block.fieldsAt;
      const fileFlags = readVint(window, at); at = fileFlags.next;
      at = readVint(window, at).next;                          // unpacked size
      at = readVint(window, at).next;                          // attributes
      if (fileFlags.value & 0x2) at += 4;                      // mtime
      if (fileFlags.value & 0x4) at += 4;                      // data CRC32
      const compression = readVint(window, at); at = compression.next;
      if (compression.value & 0x40) return null;               // solid file
      at = readVint(window, at).next;                          // host OS
      const nameLength = readVint(window, at); at = nameLength.next;
      const name = new TextDecoder("utf-8").decode(window.subarray(at, at + nameLength.value));
      if (fileFlags.value & 0x1) { offset += block.end + block.dataSize; continue; } // a directory
      entries.push({ name, headerOffset: offset, headerSize: block.end, packedSize: block.dataSize, dataOffset: offset + block.end });
      if (enough(entries[entries.length - 1]!)) break;
    }
    offset += block.end + block.dataSize;
  }
  return { version: 5, prefix, entries };
}

/** One RAR5 block at `at`: its type, where its type-specific fields start, its end and data size. */
function parseRar5Block(bytes: Uint8Array, at: number): { type: number; fieldsAt: number; end: number; dataSize: number } | null {
  if (at + 4 >= bytes.length) return null;
  const size = readVint(bytes, at + 4), start = size.next;
  const type = readVint(bytes, start), flags = readVint(bytes, type.next);
  let p = flags.next, dataSize = 0;
  if (flags.value & 0x1) p = readVint(bytes, p).next;        // extra area size
  if (flags.value & 0x2) { const data = readVint(bytes, p); dataSize = data.value; p = data.next; }
  return { type: type.value, fieldsAt: p, end: start + size.value, dataSize };
}

function readVint(bytes: Uint8Array, at: number): { value: number; next: number } {
  let value = 0, shift = 0, p = at;
  for (; p < bytes.length && p < at + 10; p++) {
    const byte = bytes[p]!; value += (byte & 0x7f) * 2 ** shift; shift += 7;
    if (!(byte & 0x80)) return { value, next: p + 1 };
  }
  throw new Error("CBR_TRUNCATED_HEADER");
}

function rar5EndBlock(): Uint8Array {
  const body = new Uint8Array([0x03, 0x05, 0x00, 0x00]);      // size 3: type 5 (end), flags 0, end flags 0
  const crc = crc32(body), out = new Uint8Array(8);
  new DataView(out.buffer).setUint32(0, crc, true); out.set(body, 4);
  return out;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
function starts(bytes: Uint8Array, prefix: readonly number[]): boolean { return prefix.every((value, index) => bytes[index] === value); }
function dv(bytes: Uint8Array): DataView { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
