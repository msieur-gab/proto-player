// Minimal ID3v2.3 / v2.4 parser — pure vanilla JS, no dependencies
// Reads only the tag header bytes from the file (not the whole file)

/**
 * Parse ID3v2 tags from an MP3 File object
 * @param {File} file
 * @returns {Promise<{ title, artist, album, track, picture }>}
 */
export async function parseID3(file) {
  const result = { title: null, artist: null, album: null, track: null, picture: null };

  // Read the 10-byte ID3 header
  let headerBuf;
  try {
    headerBuf = await readSlice(file, 0, 10);
  } catch {
    return result; // File unreadable (permission lost, etc.)
  }
  if (headerBuf.byteLength < 10) return result;
  const header = new DataView(headerBuf);

  // Check "ID3" magic
  if (
    header.getUint8(0) !== 0x49 || // I
    header.getUint8(1) !== 0x44 || // D
    header.getUint8(2) !== 0x33    // 3
  ) {
    return result; // No ID3 tag
  }

  const major = header.getUint8(3); // 3 or 4
  if (major < 3 || major > 4) return result;

  const flags = header.getUint8(5);
  const tagSize = decodeSyncsafe(header, 6);

  // Skip extended header if present
  let offset = 10;
  if (flags & 0x40) {
    const extBuf = await readSlice(file, 10, 4);
    const extView = new DataView(extBuf);
    const extSize = major === 4
      ? decodeSyncsafe(extView, 0)
      : extView.getUint32(0);
    offset += extSize;
  }

  // Read the entire tag body
  const tagEnd = 10 + tagSize;
  const bodyBuf = await readSlice(file, offset, tagEnd - offset);
  const body = new DataView(bodyBuf);
  let pos = 0;

  const WANTED = new Set(['TIT2', 'TPE1', 'TALB', 'TRCK', 'APIC']);

  while (pos + 10 <= body.byteLength) {
    const frameId = String.fromCharCode(
      body.getUint8(pos), body.getUint8(pos + 1),
      body.getUint8(pos + 2), body.getUint8(pos + 3)
    );

    // Stop on padding (null bytes)
    if (frameId[0] === '\0') break;

    const frameSize = major === 4
      ? decodeSyncsafe(body, pos + 4)
      : body.getUint32(pos + 4);

    // const frameFlags = body.getUint16(pos + 8);
    pos += 10;

    if (frameSize === 0 || pos + frameSize > body.byteLength) break;

    if (WANTED.has(frameId)) {
      const frameData = new Uint8Array(bodyBuf, pos, frameSize);

      if (frameId === 'APIC') {
        result.picture = parseAPIC(frameData);
      } else {
        const text = decodeTextFrame(frameData);
        if (frameId === 'TIT2') result.title = text;
        else if (frameId === 'TPE1') result.artist = text;
        else if (frameId === 'TALB') result.album = text;
        else if (frameId === 'TRCK') result.track = text;
      }
    }

    pos += frameSize;
  }

  return result;
}

/**
 * Convert an extracted APIC picture object to a blob URL
 * @param {{ mime: string, data: Uint8Array }} picture
 * @returns {string} blob URL
 */
export function pictureToURL(picture) {
  if (!picture || !picture.data) return null;
  const blob = new Blob([picture.data], { type: picture.mime || 'image/jpeg' });
  return URL.createObjectURL(blob);
}

// --- Internal helpers ---

function readSlice(file, start, length) {
  return file.slice(start, start + length).arrayBuffer();
}

function decodeSyncsafe(view, offset) {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  );
}

/**
 * Decode a text frame (TIT2, TPE1, TALB, TRCK)
 * First byte is the encoding flag
 */
function decodeTextFrame(data) {
  if (data.length < 2) return '';
  const encoding = data[0];
  const textBytes = data.subarray(1);
  return decodeString(textBytes, encoding).trim();
}

/**
 * Parse APIC (attached picture) frame
 * Layout: encoding(1) + mime(null-terminated) + picType(1) + description(null-terminated) + imageData
 */
function parseAPIC(data) {
  if (data.length < 4) return null;

  const encoding = data[0];
  let pos = 1;

  // Read MIME type (always ISO-8859-1 / ASCII, null-terminated)
  let mime = '';
  while (pos < data.length && data[pos] !== 0) {
    mime += String.fromCharCode(data[pos]);
    pos++;
  }
  pos++; // skip null

  if (pos >= data.length) return null;

  // Picture type (1 byte) — 0x03 = front cover, but we accept any
  // const picType = data[pos];
  pos++;

  // Skip description (null-terminated, encoding-dependent)
  if (encoding === 1 || encoding === 2) {
    // UTF-16: look for double-null
    while (pos + 1 < data.length) {
      if (data[pos] === 0 && data[pos + 1] === 0) { pos += 2; break; }
      pos += 2;
    }
  } else {
    // ISO-8859-1 or UTF-8: single null
    while (pos < data.length && data[pos] !== 0) pos++;
    pos++; // skip null
  }

  if (pos >= data.length) return null;

  return {
    mime: mime || 'image/jpeg',
    data: data.slice(pos),
  };
}

/**
 * Decode a byte sequence with the given ID3 encoding flag
 * 0 = ISO-8859-1, 1 = UTF-16 (with BOM), 2 = UTF-16BE, 3 = UTF-8
 */
function decodeString(bytes, encoding) {
  switch (encoding) {
    case 0: // ISO-8859-1
      return decodeLatin1(bytes);

    case 1: { // UTF-16 with BOM
      if (bytes.length < 2) return '';
      const bom0 = bytes[0], bom1 = bytes[1];
      const le = bom0 === 0xff && bom1 === 0xfe;
      const textBytes = bytes.subarray(2);
      return decodeUTF16(textBytes, le);
    }

    case 2: // UTF-16BE (no BOM)
      return decodeUTF16(bytes, false);

    case 3: // UTF-8
      return new TextDecoder('utf-8').decode(bytes);

    default:
      return decodeLatin1(bytes);
  }
}

function decodeLatin1(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) break; // null terminator
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

function decodeUTF16(bytes, littleEndian) {
  let str = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = littleEndian
      ? bytes[i] | (bytes[i + 1] << 8)
      : (bytes[i] << 8) | bytes[i + 1];
    if (code === 0) break; // null terminator
    str += String.fromCharCode(code);
  }
  return str;
}
