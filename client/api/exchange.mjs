import { createRequire } from 'node:module';
import { decodeTimelineArchive, encodeTimelineArchive } from '../domain/exchange.mjs';
const require = createRequire(new URL('../client/package.json', import.meta.url));
const JSZip = require('jszip');

/** Repository reads, target permissions and revision preconditions belong to the gateway. */
export async function decodeArchive(buffer) {
  const decoded = await decodeTimelineArchive(JSZip, buffer);
  return { ...decoded, covers: new Map([...decoded.covers].map(([name, bytes]) => [name, Buffer.from(bytes)])) };
}
export async function encodeArchive(timeline, entries, readCover) {
  const name = typeof timeline === 'string' ? timeline : timeline.Name || timeline.DisplayName;
  const encoded = await encodeTimelineArchive(JSZip, name, entries, readCover);
  const { bytes, ...metadata } = encoded;
  return { ...metadata, buffer: Buffer.from(bytes) };
}
