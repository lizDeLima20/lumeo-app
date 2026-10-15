/** Bumped whenever detection or recognition changes what a page yields, so a comic that
 *  was converted by an older pipeline is read again instead of served from the cache. */
// v4 persists the BODY-element hierarchy and diagnostics. Older packages remain intact
// as prior cache entries while the source comic is reprocessed under this new key.
// v5 fixes two v4 defects: OCR prompts reached MobileSAM at twice their position after an
// inSampleSize decode, and float rounding (share 1.0000000000000002) failed whole pages.
// Every page written under the v4 key is affected, so only those are left unused; the
// original comic, reading progress and earlier versions' entries are untouched.
export const COMIC_CONVERSION_VERSION = "comic-mobilesam-body-vision-v5-prompt-geometry";

export async function comicSourceKey(blob: Blob, coverPages: readonly number[] = [0]): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return `${COMIC_CONVERSION_VERSION}:${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("")}:${[...new Set(coverPages)].sort((a, b) => a - b).join(",")}`;
}
