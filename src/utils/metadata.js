// Metadata parsers for non-MP3 audio formats
// FLAC → Vorbis Comments, OGG/Opus → Vorbis Comments, M4A/AAC → MP4 atoms

/**
 * Parse metadata from a FLAC file
 * Structure: "fLaC" magic + metadata blocks (VORBIS_COMMENT = type 4, PICTURE = type 6)
 */
export async function parseFLAC(file) {
  const result = { title: null, artist: null, album: null, track: null, picture: null };

  let buf;
  try {
    buf = await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer();
  } catch {
    return result;
  }

  const view = new DataView(buf);
  if (buf.byteLength < 8) return result;

  // Check "fLaC" magic
  if (view.getUint32(0) !== 0x664C6143) return result;

  let pos = 4;

  while (pos + 4 <= buf.byteLength) {
    const header = view.getUint32(pos);
    const isLast = (header >>> 31) === 1;
    const blockType = (header >>> 24) & 0x7F;
    const blockLen = header & 0x00FFFFFF;
    pos += 4;

    if (pos + blockLen > buf.byteLength) break;

    if (blockType === 4) {
      parseVorbisComment(new DataView(buf, pos, blockLen), result);
    } else if (blockType === 6) {
      parseFLACPicture(new DataView(buf, pos, blockLen), new Uint8Array(buf, pos, blockLen), result);
    }

    pos += blockLen;
    if (isLast) break;
  }

  return result;
}

/**
 * Parse metadata from an OGG file (Vorbis or Opus)
 * Structure: OGG pages → first few pages contain identification + comment headers
 */
export async function parseOGG(file) {
  const result = { title: null, artist: null, album: null, track: null, picture: null };

  let buf;
  try {
    buf = await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer();
  } catch {
    return result;
  }

  const bytes = new Uint8Array(buf);
  if (buf.byteLength < 28) return result;

  let pageStart = 0;
  let pageCount = 0;

  while (pageStart + 27 <= buf.byteLength && pageCount < 10) {
    // Check "OggS" magic
    if (bytes[pageStart] !== 0x4F || bytes[pageStart + 1] !== 0x67 ||
        bytes[pageStart + 2] !== 0x67 || bytes[pageStart + 3] !== 0x53) break;

    const numSegments = bytes[pageStart + 26];
    if (pageStart + 27 + numSegments > buf.byteLength) break;

    let bodySize = 0;
    for (let i = 0; i < numSegments; i++) {
      bodySize += bytes[pageStart + 27 + i];
    }

    const bodyStart = pageStart + 27 + numSegments;

    if (pageCount >= 1 && bodyStart + bodySize <= buf.byteLength) {
      const body = new Uint8Array(buf, bodyStart, bodySize);

      let commentStart = findVorbisCommentStart(body);
      if (commentStart >= 0 && commentStart < bodySize) {
        parseVorbisComment(
          new DataView(buf, bodyStart + commentStart, bodySize - commentStart),
          result
        );
        if (result.title || result.artist) break;
      }
    }

    pageStart = bodyStart + bodySize;
    pageCount++;
  }

  return result;
}

/**
 * Parse metadata from an M4A/AAC file (MP4 container)
 * Structure: atoms (ftyp, moov > udta > meta > ilst > ©nam, ©ART, ©alb, trkn, covr)
 */
export async function parseM4A(file) {
  const result = { title: null, artist: null, album: null, track: null, picture: null };

  let buf;
  try {
    buf = await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer();
  } catch {
    return result;
  }

  const view = new DataView(buf);
  if (buf.byteLength < 8) return result;

  const moov = findAtom(view, 0, buf.byteLength, 'moov');
  if (!moov) return result;

  const udta = findAtom(view, moov.dataStart, moov.end, 'udta');
  if (!udta) return result;

  const meta = findAtom(view, udta.dataStart, udta.end, 'meta');
  if (!meta) return result;

  // 'meta' has a 4-byte version/flags field after the header
  const metaDataStart = meta.dataStart + 4;

  const ilst = findAtom(view, metaDataStart, meta.end, 'ilst');
  if (!ilst) return result;

  let pos = ilst.dataStart;
  while (pos + 8 <= ilst.end) {
    const atomSize = view.getUint32(pos);
    if (atomSize < 8 || pos + atomSize > ilst.end) break;

    const atomType = String.fromCharCode(
      view.getUint8(pos + 4), view.getUint8(pos + 5),
      view.getUint8(pos + 6), view.getUint8(pos + 7)
    );

    const dataAtom = findAtom(view, pos + 8, pos + atomSize, 'data');
    if (dataAtom && dataAtom.end - dataAtom.dataStart > 8) {
      const valueStart = dataAtom.dataStart + 8;
      const valueLen = dataAtom.end - valueStart;

      if (valueLen > 0) {
        if (atomType === '\xA9nam') {
          result.title = decodeUTF8(new Uint8Array(buf, valueStart, valueLen));
        } else if (atomType === '\xA9ART') {
          result.artist = decodeUTF8(new Uint8Array(buf, valueStart, valueLen));
        } else if (atomType === '\xA9alb') {
          result.album = decodeUTF8(new Uint8Array(buf, valueStart, valueLen));
        } else if (atomType === 'trkn' && valueLen >= 4) {
          result.track = String(view.getUint16(valueStart + 2));
        } else if (atomType === 'covr' && valueLen > 16) {
          const typeFlag = view.getUint32(dataAtom.dataStart);
          const mime = typeFlag === 14 ? 'image/png' : 'image/jpeg';
          result.picture = {
            mime,
            data: new Uint8Array(buf, valueStart, valueLen),
          };
        }
      }
    }

    pos += atomSize;
  }

  return result;
}

// --- Vorbis Comment parser (shared by FLAC and OGG) ---

function parseVorbisComment(view, result) {
  let pos = 0;
  if (pos + 4 > view.byteLength) return;

  const vendorLen = view.getUint32(pos, true);
  pos += 4 + vendorLen;

  if (pos + 4 > view.byteLength) return;

  const count = view.getUint32(pos, true);
  pos += 4;

  for (let i = 0; i < count && pos + 4 <= view.byteLength; i++) {
    const commentLen = view.getUint32(pos, true);
    pos += 4;

    if (pos + commentLen > view.byteLength) break;

    const bytes = new Uint8Array(view.buffer, view.byteOffset + pos, commentLen);
    const comment = decodeUTF8(bytes);
    const eq = comment.indexOf('=');

    if (eq > 0) {
      const key = comment.slice(0, eq).toUpperCase();
      const value = comment.slice(eq + 1);

      if (key === 'TITLE') result.title = value;
      else if (key === 'ARTIST') result.artist = value;
      else if (key === 'ALBUM') result.album = value;
      else if (key === 'TRACKNUMBER') result.track = value;
      else if (key === 'METADATA_BLOCK_PICTURE' && !result.picture) {
        try {
          const bin = atob(value);
          const arr = new Uint8Array(bin.length);
          for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
          const picView = new DataView(arr.buffer);
          parseFLACPicture(picView, arr, result);
        } catch { /* ignore malformed picture */ }
      }
    }

    pos += commentLen;
  }
}

// --- FLAC PICTURE block parser ---

function parseFLACPicture(view, bytes, result) {
  if (result.picture) return;
  if (view.byteLength < 32) return;

  let pos = 0;

  const picType = view.getUint32(pos);
  pos += 4;

  const mimeLen = view.getUint32(pos);
  pos += 4;
  if (pos + mimeLen > view.byteLength) return;
  const mime = decodeUTF8(bytes.slice(pos, pos + mimeLen)) || 'image/jpeg';
  pos += mimeLen;

  const descLen = view.getUint32(pos);
  pos += 4 + descLen;

  // Width, height, color depth, colors used
  pos += 16;

  if (pos + 4 > view.byteLength) return;

  const dataLen = view.getUint32(pos);
  pos += 4;

  if (pos + dataLen > view.byteLength) return;

  result.picture = {
    mime,
    data: bytes.slice(pos, pos + dataLen),
  };
}

// --- MP4 atom helpers ---

function findAtom(view, start, end, name) {
  let pos = start;
  while (pos + 8 <= end) {
    const size = view.getUint32(pos);
    if (size < 8) {
      pos += 4;
      continue;
    }
    if (pos + size > end) break;

    const type = String.fromCharCode(
      view.getUint8(pos + 4), view.getUint8(pos + 5),
      view.getUint8(pos + 6), view.getUint8(pos + 7)
    );

    if (type === name) {
      return { dataStart: pos + 8, end: pos + size };
    }

    pos += size;
  }
  return null;
}

// --- OGG helpers ---

function findVorbisCommentStart(body) {
  // Vorbis: look for "\x03vorbis"
  for (let i = 0; i + 7 <= body.length; i++) {
    if (body[i] === 0x03 &&
        body[i + 1] === 0x76 && body[i + 2] === 0x6F &&
        body[i + 3] === 0x72 && body[i + 4] === 0x62 &&
        body[i + 5] === 0x69 && body[i + 6] === 0x73) {
      return i + 7;
    }
  }
  // Opus: look for "OpusTags"
  for (let i = 0; i + 8 <= body.length; i++) {
    if (body[i] === 0x4F && body[i + 1] === 0x70 &&
        body[i + 2] === 0x75 && body[i + 3] === 0x73 &&
        body[i + 4] === 0x54 && body[i + 5] === 0x61 &&
        body[i + 6] === 0x67 && body[i + 7] === 0x73) {
      return i + 8;
    }
  }
  return -1;
}

// --- Shared ---

function decodeUTF8(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}
