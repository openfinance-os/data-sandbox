// Minimal STORE-only ZIP writer — Workstream C plug-point 3.
// Builds a zip file from a list of {path, bytes} entries with no
// compression (STORE method). Output is larger than DEFLATE but the
// implementation fits on one screen and avoids the JSZip dependency
// while still producing a file every standard archive tool accepts.
//
// References: APPNOTE.TXT v6.3.10 (PKWARE), local file header §4.3.7,
// central directory §4.3.12, end-of-central-directory record §4.3.16.

const TEXT_ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function utf8Bytes(str) {
  if (TEXT_ENCODER) return TEXT_ENCODER.encode(str);
  // Node fallback (older runtimes).
  return new Uint8Array(Buffer.from(str, 'utf8'));
}

// CRC-32 table (IEEE polynomial 0xedb88320). Computed once at module load.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeU16(view, off, val) { view.setUint16(off, val, true); }
function writeU32(view, off, val) { view.setUint32(off, val >>> 0, true); }

// Build a zip Blob from `entries`. Each entry: { path: string, bytes: Uint8Array }.
// Returns a Blob; the caller is responsible for triggering the download.
export function buildZip(entries) {
  const localChunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = utf8Bytes(e.path);
    const dataBytes = e.bytes;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 bytes + name).
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lhView = new DataView(localHeader.buffer);
    writeU32(lhView, 0, 0x04034b50);   // signature
    writeU16(lhView, 4, 20);            // version needed
    writeU16(lhView, 6, 0);             // general purpose flags
    writeU16(lhView, 8, 0);             // method (0 = STORE)
    writeU16(lhView, 10, 0);            // mod time
    writeU16(lhView, 12, 0);            // mod date
    writeU32(lhView, 14, crc);
    writeU32(lhView, 18, size);         // compressed size = uncompressed for STORE
    writeU32(lhView, 22, size);         // uncompressed size
    writeU16(lhView, 26, nameBytes.length);
    writeU16(lhView, 28, 0);            // extra field length
    localHeader.set(nameBytes, 30);

    localChunks.push(localHeader, dataBytes);
    const localOffset = offset;
    offset += localHeader.length + dataBytes.length;

    // Central directory entry (46 bytes + name).
    const cdEntry = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cdEntry.buffer);
    writeU32(cdView, 0, 0x02014b50);
    writeU16(cdView, 4, 20);            // version made by
    writeU16(cdView, 6, 20);            // version needed
    writeU16(cdView, 8, 0);
    writeU16(cdView, 10, 0);
    writeU16(cdView, 12, 0);
    writeU16(cdView, 14, 0);
    writeU32(cdView, 16, crc);
    writeU32(cdView, 20, size);
    writeU32(cdView, 24, size);
    writeU16(cdView, 28, nameBytes.length);
    writeU16(cdView, 30, 0);
    writeU16(cdView, 32, 0);
    writeU16(cdView, 34, 0);
    writeU16(cdView, 36, 0);
    writeU32(cdView, 38, 0);            // external attrs
    writeU32(cdView, 42, localOffset);
    cdEntry.set(nameBytes, 46);
    central.push(cdEntry);
  }

  const cdSize = central.reduce((acc, c) => acc + c.length, 0);
  const cdOffset = offset;

  // End of central directory record (22 bytes, no comment).
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  writeU32(eocdView, 0, 0x06054b50);
  writeU16(eocdView, 4, 0);
  writeU16(eocdView, 6, 0);
  writeU16(eocdView, 8, central.length);
  writeU16(eocdView, 10, central.length);
  writeU32(eocdView, 12, cdSize);
  writeU32(eocdView, 16, cdOffset);
  writeU16(eocdView, 20, 0);            // comment length

  const allChunks = [...localChunks, ...central, eocd];
  // Single Uint8Array assembly so callers in Node (no Blob) can read bytes
  // directly. Blob construction is left to the caller.
  let total = 0;
  for (const c of allChunks) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of allChunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
