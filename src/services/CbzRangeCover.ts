/**
 * First page of a CBZ read by byte ranges, so a Drive comic gets a real cover without being
 * downloaded: the ZIP's end record, its central directory and one image are fetched, at
 * most a few megabytes, never the whole archive. CBR (RAR) archives cannot be read this way;
 * they keep Drive's thumbnail or the placeholder until the file is on the device.
 */
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

export interface CbzEntry { name: string; method: number; compressedSize: number; size: number; localHeaderOffset: number; }

const EOCD = 0x06054b50, ZIP64_LOCATOR = 0x07064b50, ZIP64_EOCD = 0x06064b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const TAIL_BYTES = 65_557;                  // largest end-of-central-directory record with comment
const MAX_DIRECTORY_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE = /\.(jpe?g|png|webp|gif|bmp)$/i;

/** The archive's entries, from its central directory. */
export async function readCbzDirectory(read: RangeReader, totalSize: number): Promise<CbzEntry[]> {
  if (!Number.isSafeInteger(totalSize) || totalSize < 22) throw new Error("CBZ_TOO_SMALL");
  const tailStart = Math.max(0, totalSize - TAIL_BYTES), tail = await read(tailStart, totalSize - 1);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (view.getUint32(i, true) === EOCD) { eocd = i; break; }
  if (eocd < 0) throw new Error("CBZ_NOT_ZIP");
  let count = view.getUint16(eocd + 10, true), size = view.getUint32(eocd + 12, true), offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff || size === 0xffffffff || count === 0xffff) {
    // ZIP64: the locator sits just before the classic record and points at the 64-bit one.
    const locator = eocd - 20;
    if (locator < 0 || view.getUint32(locator, true) !== ZIP64_LOCATOR) throw new Error("CBZ_ZIP64_UNREADABLE");
    const recordOffset = Number(view.getBigUint64(locator + 8, true));
    const record = await read(recordOffset, recordOffset + 55), rv = new DataView(record.buffer, record.byteOffset, record.byteLength);
    if (rv.getUint32(0, true) !== ZIP64_EOCD) throw new Error("CBZ_ZIP64_UNREADABLE");
    count = Number(rv.getBigUint64(32, true)); size = Number(rv.getBigUint64(40, true)); offset = Number(rv.getBigUint64(48, true));
  }
  if (size <= 0 || size > MAX_DIRECTORY_BYTES || offset + size > totalSize) throw new Error("CBZ_DIRECTORY_TOO_LARGE");
  const directory = await read(offset, offset + size - 1), dv = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries: CbzEntry[] = [];
  for (let at = 0, n = 0; n < count && at + 46 <= directory.length; n++) {
    if (dv.getUint32(at, true) !== CENTRAL) break;
    const nameLength = dv.getUint16(at + 28, true), extraLength = dv.getUint16(at + 30, true), commentLength = dv.getUint16(at + 32, true);
    let compressedSize = dv.getUint32(at + 20, true), uncompressed = dv.getUint32(at + 24, true), local = dv.getUint32(at + 42, true);
    const name = new TextDecoder().decode(directory.subarray(at + 46, at + 46 + nameLength));
    // ZIP64 extra field (id 1): 64-bit values only for the fields that overflowed, in order.
    for (let e = at + 46 + nameLength, end = e + extraLength; e + 4 <= end;) {
      const id = dv.getUint16(e, true), length = dv.getUint16(e + 2, true); let p = e + 4;
      if (id === 1) {
        if (uncompressed === 0xffffffff) { uncompressed = Number(dv.getBigUint64(p, true)); p += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = Number(dv.getBigUint64(p, true)); p += 8; }
        if (local === 0xffffffff) local = Number(dv.getBigUint64(p, true));
      }
      e += 4 + length;
    }
    entries.push({ name, method: dv.getUint16(at + 10, true), compressedSize, size: uncompressed, localHeaderOffset: local });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The comic's first page: the first image in natural reading order, ignoring macOS
 *  resource forks and hidden files. */
export function firstCbzPage(entries: readonly CbzEntry[]): CbzEntry | null {
  const pages = entries.filter(entry => IMAGE.test(entry.name) && !/(^|\/)(__MACOSX|\.)/.test(entry.name) && entry.size > 0);
  pages.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  return pages[0] ?? null;
}

/** Reads one entry's bytes (stored or deflated) through two small ranges. */
export async function readCbzEntry(read: RangeReader, entry: CbzEntry): Promise<Blob> {
  if (entry.compressedSize <= 0 || entry.compressedSize > MAX_IMAGE_BYTES) throw new Error("CBZ_PAGE_TOO_LARGE");
  const header = await read(entry.localHeaderOffset, entry.localHeaderOffset + 29), hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (hv.getUint32(0, true) !== LOCAL) throw new Error("CBZ_BAD_LOCAL_HEADER");
  const dataStart = entry.localHeaderOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const data = await read(dataStart, dataStart + entry.compressedSize - 1);
  let bytes: Uint8Array;
  if (entry.method === 0) bytes = data;
  else if (entry.method === 8) {
    const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } else throw new Error("CBZ_UNSUPPORTED_COMPRESSION");
  const ext = /\.([a-z]+)$/i.exec(entry.name)?.[1]?.toLowerCase() ?? "jpeg";
  const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  return new Blob([new Uint8Array(bytes)], { type });
}

/** Directory, first page, page bytes: the whole ranged read. */
export async function cbzCoverByRange(read: RangeReader, totalSize: number): Promise<Blob | null> {
  const page = firstCbzPage(await readCbzDirectory(read, totalSize));
  return page ? readCbzEntry(read, page) : null;
}
