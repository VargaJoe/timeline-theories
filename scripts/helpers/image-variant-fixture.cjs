'use strict';

// Deterministic, valid, noninterlaced 8-bit RGBA PNG for real repository probes.
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const crcTable = Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) byte = (byte >>> 1) ^ (byte & 1 ? 0xedb88320 : 0);
  return byte >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const payload = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, crc]);
}
function png(width, height, seed = 0) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4_000_000) throw new Error('Invalid probe image dimensions.');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (1 + width * 4) + 1 + x * 4;
    rows[offset] = (x + seed * 53) % 256;
    rows[offset + 1] = (y + seed * 29) % 256;
    rows[offset + 2] = ((x ^ y) + seed * 37) % 256;
    rows[offset + 3] = 255;
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
module.exports = { png, sha256 };
