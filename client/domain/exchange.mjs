import { DomainError, assertId, safeName, validateFields, validatePublicUrl } from './content.mjs';

/** The active UI exchange format; this is deliberately not a lossless backup. */
export const TSV_COLUMNS = Object.freeze(['timeline_name', 'entry_name', 'Title', 'Description', 'MediaType', 'media_id', 'cover_image', 'ChronologicalDate', 'Position', 'Notes', 'EntryLabel', 'Importance', 'ChronologicalDescription', 'Author', 'Publisher', 'ISBN', 'PublicationYear', 'Genre', 'Tags']);
export const EXCHANGE_LIMITS = Object.freeze({ archiveBytes: 64 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, tsvBytes: 8 * 1024 * 1024, coverBytes: 10 * 1024 * 1024, rows: 5000, files: 5010, compressionRatio: 200 });
const fail = (message, code = 'invalid_archive') => { throw new DomainError(code, message); };
const single = value => {
  if (!Array.isArray(value)) return value;
  if (value.length > 1) fail('A single choice field contains multiple values.');
  return value[0];
};
export const escapeTSVField = value => value === undefined || value === null ? '' : String(value).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
export const unescapeTSVField = value => value.replace(/\\([\\tnr])/g, (_match, escaped) => ({ '\\': '\\', t: '\t', n: '\n', r: '\r' })[escaped]);
const arrayToString = value => Array.isArray(value) ? value.join(', ') : value || '';
const stringToArray = value => value.split(',').map(item => item.trim()).filter(Boolean);
const integer = (value, field, fallback = 0) => {
  if (value === '') return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) fail(`${field} must be a non-negative integer.`);
  return Number(value);
};
export function coverFilename(value) {
  try { return safeName(value); } catch { fail('Cover filenames must be single safe path segments.'); }
}
export function parseTSV(content) {
  if (typeof content !== 'string' || new TextEncoder().encode(content).byteLength > EXCHANGE_LIMITS.tsvBytes) fail('TSV exceeds the size limit.', 'archive_limit');
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) fail('TSV file must contain at least a header and one data row.');
  if (lines[0] !== TSV_COLUMNS.join('\t')) fail('TSV must use the active 19-column timeline header.');
  if (lines.length - 1 > EXCHANGE_LIMITS.rows) fail('Archive contains too many timeline rows.', 'archive_limit');
  const names = new Set(); let timelineName;
  const entries = lines.slice(1).map((line, index) => {
    const fields = line.split('\t').map(unescapeTSVField);
    if (fields.length !== TSV_COLUMNS.length) fail(`Invalid TSV row ${index + 2}: expected exactly 19 columns.`);
    if (timelineName === undefined) timelineName = fields[0];
    if (fields[0] !== timelineName) fail('Archive contains multiple timeline names.');
    try { safeName(fields[1]); } catch { fail(`Invalid occurrence Name in TSV row ${index + 2}.`); }
    if (names.has(fields[1])) fail('Archive contains duplicate occurrence Names.');
    names.add(fields[1]);
    const mediaId = integer(fields[5], 'media_id');
    try { assertId(mediaId); } catch { fail('Archive needs a valid existing local media reference.'); }
    if (fields[6]) coverFilename(fields[6]);
    return { entryName: fields[1], Title: fields[2], Description: fields[3], MediaType: fields[4], mediaId: String(mediaId), coverImageFilename: fields[6], ChronologicalDate: fields[7], Position: integer(fields[8], 'Position'), Notes: fields[9], EntryLabel: fields[10], Importance: fields[11], ChronologicalDescription: fields[12], Author: fields[13], Publisher: fields[14], ISBN: fields[15], PublicationYear: integer(fields[16], 'PublicationYear'), Genre: stringToArray(fields[17]), Tags: stringToArray(fields[18]) };
  });
  return { timelineName, entries };
}
/** Only occurrence fields are imported. Existing local media is referenced, never recreated. */
export function entryFieldsFromRow(row, { displayName, choices } = {}) {
  return validateFields('TimelineEntry', { Name: row.entryName, DisplayName: row.Title || displayName || 'Unnamed Entry', MediaItem: Number(row.mediaId), Position: row.Position, ChronologicalDate: row.ChronologicalDate || null, ChronologicalDescription: row.ChronologicalDescription, Notes: row.Notes, EntryLabel: row.EntryLabel, Importance: row.Importance }, { create: true, choices });
}
export function normalizeExchangeEntry(entry) {
  const value = (lower, upper) => entry[lower] ?? entry[upper];
  const reference = value('mediaItem', 'MediaItem');
  const media = Array.isArray(reference) ? reference[0] : reference;
  return { name: value('name', 'Name'), displayName: value('displayName', 'DisplayName'), mediaItem: media && typeof media === 'object' ? media : null, position: value('position', 'Position'), chronologicalDate: value('chronologicalDate', 'ChronologicalDate'), chronologicalDescription: value('chronologicalDescription', 'ChronologicalDescription'), notes: value('notes', 'Notes'), entryLabel: single(value('entryLabel', 'EntryLabel')), importance: single(value('importance', 'Importance')) };
}
export function buildTSV(entries, timelineName, coverFilenames = new Map()) {
  if (!Array.isArray(entries) || entries.length > EXCHANGE_LIMITS.rows) fail('Too many timeline entries.', 'archive_limit');
  const names = new Set();
  const rows = entries.map((item, index) => {
    const entry = normalizeExchangeEntry(item); const media = entry.mediaItem;
    safeName(entry.name);
    if (names.has(entry.name)) fail('Timeline contains duplicate occurrence Names.');
    names.add(entry.name);
    assertId(media?.Id);
    const cover = coverFilenames.get(index) || '';
    if (cover) coverFilename(cover);
    return [timelineName, entry.name, media?.Title || entry.displayName, media?.Description, single(media?.MediaType), media?.Id || '', cover, entry.chronologicalDate, entry.position || '', entry.notes, entry.entryLabel, entry.importance, entry.chronologicalDescription, media?.Author, media?.Publisher, media?.ISBN, media?.PublicationYear || '', arrayToString(media?.Genre), arrayToString(media?.Tags)].map(escapeTSVField).join('\t');
  });
  const content = [TSV_COLUMNS.join('\t'), ...rows].join('\n');
  if (new TextEncoder().encode(content).byteLength > EXCHANGE_LIMITS.tsvBytes) fail('Export TSV exceeds the size limit.', 'archive_limit');
  return content;
}
const IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' };
export function getExtensionFromContentType(type = '') { return IMAGE_EXTENSIONS[type.toLowerCase().split(';')[0].trim()] || 'jpg'; }
export function coverMimeType(bytes) {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  fail('Archive covers must contain PNG, JPEG or WebP image data.', 'invalid_cover');
}
export function exportFilename(timelineName, now = new Date()) { return `timeline-${String(timelineName).replace(/[^a-z0-9]/gi, '_').toLowerCase()}-${now.toISOString().split('T')[0]}.zip`; }
async function bytesOf(value) {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    if (value.size > EXCHANGE_LIMITS.archiveBytes) fail('Archive exceeds the size limit.', 'archive_limit');
    return new Uint8Array(await value.arrayBuffer());
  }
  fail('Expected ZIP binary data.');
}
/** Inspect declared sizes and raw names before JSZip can sanitize paths or inflate data. */
export function inspectArchive(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > EXCHANGE_LIMITS.archiveBytes || bytes.byteLength < 22) fail('Archive has an invalid size.', 'archive_limit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0) fail('ZIP end record is missing.');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count === 65535 || size === 0xffffffff || start === 0xffffffff) fail('Multi-disk and ZIP64 archives are not supported.');
  if (count > EXCHANGE_LIMITS.files || start + size !== end) fail('Archive file count or directory bounds are invalid.', 'archive_limit');
  const files = new Map(); let offset = start, total = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) fail('Invalid ZIP directory record.');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), crc = view.getUint32(offset + 16, true), compressed = view.getUint32(offset + 20, true), uncompressed = view.getUint32(offset + 24, true), nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true), local = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end || flags & 1 || ![0, 8].includes(method) || uncompressed === 0xffffffff || compressed === 0xffffffff || local === 0xffffffff || view.getUint16(offset + 34, true)) fail('Encrypted, ZIP64 or unsupported ZIP entry.');
    const mode = view.getUint32(offset + 38, true) >>> 16;
    if ((mode & 0xf000) === 0xa000) fail('Symbolic links are not permitted in archives.');
    let name; try { name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); } catch { fail('ZIP filenames must be valid UTF-8.'); }
    if (name !== 'timeline_data.tsv' && name !== 'covers/' && !(name.startsWith('covers/') && !name.slice(7).includes('/') && name.slice(7))) fail('Archive contains an unsupported or unsafe path.');
    if (name.startsWith('covers/') && name !== 'covers/') coverFilename(name.slice(7));
    if (files.has(name)) fail('Archive contains duplicate ZIP paths.');
    const limit = name === 'timeline_data.tsv' ? EXCHANGE_LIMITS.tsvBytes : name === 'covers/' ? 0 : EXCHANGE_LIMITS.coverBytes;
    total += uncompressed;
    if (uncompressed > limit || total > EXCHANGE_LIMITS.totalBytes || uncompressed > Math.max(1024 * 1024, compressed * EXCHANGE_LIMITS.compressionRatio)) fail('Archive exceeds the inflation limit.', 'archive_limit');
    if (local + 30 > start || view.getUint32(local, true) !== 0x04034b50) fail('Invalid ZIP local file record.');
    const localNameLength = view.getUint16(local + 26, true), localExtraLength = view.getUint16(local + 28, true);
    if (local + 30 + localNameLength + localExtraLength + compressed > start || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) fail('ZIP local record does not match its directory.');
    let localName; try { localName = decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)); } catch { fail('Invalid local ZIP filename.'); }
    if (localName !== name) fail('ZIP local filenames do not match their directory.');
    files.set(name, { size: uncompressed, limit, crc }); offset = next;
  }
  if (offset !== end || !files.has('timeline_data.tsv')) fail('timeline_data.tsv not found in ZIP.');
  return { files, totalBytes: total };
}
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_value, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function readBoundedEntry(entry, expected) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, stopped = false, crc = 0xffffffff;
    const stream = entry.internalStream('uint8array');
    stream.on('data', chunk => {
      size += chunk.byteLength;
      if (size > expected.limit || size > expected.size) {
        stopped = true; stream.pause(); reject(new DomainError('archive_limit', 'ZIP entry exceeds its declared size or limit.')); return;
      }
      for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
      chunks.push(chunk);
    }).on('error', error => { stopped = true; reject(error); }).on('end', () => {
      if (stopped) return;
      if (size !== expected.size) { reject(new DomainError('invalid_archive', 'ZIP entry size does not match its directory.')); return; }
      if (((crc ^ 0xffffffff) >>> 0) !== expected.crc) { reject(new DomainError('invalid_archive', 'ZIP entry checksum does not match its directory.')); return; }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      resolve(bytes);
    }).resume();
  });
}
export async function decodeTimelineArchive(JSZip, input) {
  const bytes = await bytesOf(input); const inspected = inspectArchive(bytes);
  let zip; try { zip = await JSZip.loadAsync(bytes); } catch { fail('ZIP could not be decoded.'); }
  // Reject names supplied by Unicode extra fields that were absent from raw records.
  if (Object.keys(zip.files).some(name => !inspected.files.has(name))) fail('ZIP contains inconsistent encoded paths.');
  const tsv = zip.file('timeline_data.tsv');
  if (!tsv) fail('timeline_data.tsv not found in ZIP.');
  const tsvBytes = await readBoundedEntry(tsv, inspected.files.get('timeline_data.tsv'));
  let content; try { content = new TextDecoder('utf-8', { fatal: true }).decode(tsvBytes); } catch { fail('TSV must be valid UTF-8.'); }
  const parsed = parseTSV(content); const covers = new Map();
  for (const row of parsed.entries) {
    if (!row.coverImageFilename || covers.has(row.coverImageFilename)) continue;
    const path = 'covers/' + row.coverImageFilename, entry = zip.file(path), expected = inspected.files.get(path);
    if (!entry || !expected) fail('Cover file is missing from the archive.');
    const cover = await readBoundedEntry(entry, expected);
    if (!cover.length) fail('Cover files must not be empty.');
    coverMimeType(cover);
    covers.set(row.coverImageFilename, cover);
  }
  // Every file is bounded even if a TSV row does not use it.
  for (const [path, expected] of inspected.files) {
    if (path === 'timeline_data.tsv' || path === 'covers/' || covers.has(path.slice(7))) continue;
    const entry = zip.file(path); if (!entry) fail('Invalid cover entry.');
    await readBoundedEntry(entry, expected);
  }
  return { ...parsed, covers, stats: { entriesCount: parsed.entries.length, coversCount: covers.size, archiveBytes: bytes.length, uncompressedBytes: inspected.totalBytes } };
}
export async function encodeTimelineArchive(JSZip, timelineName, entries, readCover) {
  // Validate every occurrence before initiating any optional cover/provider reads.
  buildTSV(entries, timelineName);
  const zip = new JSZip(); const coverFilenames = new Map(); let skippedImagesCount = 0, coverBytes = 0, imageIndex = 0;
  for (const [index, item] of entries.entries()) {
    const entry = normalizeExchangeEntry(item), media = entry.mediaItem;
    const binary = media?.CoverImageBin;
    const hasBinaryCover = Boolean(binary?.__mediaresource?.media_src || binary?.Url && binary.Size > 0);
    if (!hasBinaryCover && !media?.CoverImageUrl) continue;
    if (!hasBinaryCover) {
      try { validatePublicUrl(media.CoverImageUrl); } catch { skippedImagesCount++; continue; }
    }
    const cover = await readCover(media, item, index);
    if (!cover) { skippedImagesCount++; continue; }
    const data = await bytesOf(cover.data);
    if (!data.length) { skippedImagesCount++; continue; }
    if (data.length > EXCHANGE_LIMITS.coverBytes) fail('Export cover data exceeds the size limit.', 'archive_limit');
    let mimeType; try { mimeType = coverMimeType(data); } catch { skippedImagesCount++; continue; }
    coverBytes += data.length;
    if (coverBytes > EXCHANGE_LIMITS.totalBytes) fail('Export cover data exceeds the size limit.', 'archive_limit');
    const filename = `cover_${imageIndex++}.${getExtensionFromContentType(mimeType)}`;
    zip.file('covers/' + filename, data); coverFilenames.set(index, filename);
  }
  const tsv = buildTSV(entries, timelineName, coverFilenames);
  const uncompressedBytes = coverBytes + new TextEncoder().encode(tsv).byteLength;
  if (uncompressedBytes > EXCHANGE_LIMITS.totalBytes) fail('Export exceeds the total size limit.', 'archive_limit');
  zip.file('timeline_data.tsv', tsv);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  if (bytes.length > EXCHANGE_LIMITS.archiveBytes) fail('Export archive exceeds the size limit.', 'archive_limit');
  return { bytes, filename: exportFilename(timelineName), skippedImagesCount, stats: { entriesCount: entries.length, coversCount: coverFilenames.size, archiveBytes: bytes.length, uncompressedBytes, skippedImagesCount } };
}
