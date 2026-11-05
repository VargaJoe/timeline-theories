import { imageRequestQueue } from './imageLoading';

export interface ImageGenerationSource { id: number; url: string; stamp: string; }
export interface GeneratedImageVariant {
  name: string;
  width: number;
  height: number;
  mimeType: 'image/webp' | 'image/png';
  byteLength: number;
  sha256: string;
  blob: Blob;
}
export interface GeneratedImageSet {
  recipe: { template: 'poster-strip-v1' | 'media-sizes-v1'; sourceIds: number[]; seed?: number };
  sources: ImageGenerationSource[];
  variants: GeneratedImageVariant[];
}
export interface GenerateImageVariantsOptions {
  kind: 'timeline-composite' | 'media-sizes';
  sources: ImageGenerationSource[];
  seed?: number;
  signal?: AbortSignal;
  fetchSource: (source: ImageGenerationSource, signal: AbortSignal) => Promise<Blob>;
  assertContext?: () => void;
}

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 32 * 1024 * 1024;
const MAX_VARIANT_BYTES = 1024 * 1024;
const MAX_SET_BYTES = 3 * MAX_VARIANT_BYTES;
const abortError = () => new DOMException('Image generation was cancelled.', 'AbortError');
const pngCrcTable = Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) byte = (byte >>> 1) ^ (byte & 1 ? 0xedb88320 : 0);
  return byte >>> 0;
});

/** Normalize our own canvas fallback, never originals, to the backend's strict RGBA/RGB PNG subset. */
export async function normalizeGeneratedPng(blob: Blob): Promise<Blob> {
  if (!blob.size || blob.size > MAX_VARIANT_BYTES || blob.type !== 'image/png') throw new Error('Generated PNG exceeds the 1 MiB limit.');
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 45 || signature.some((value, index) => bytes[index] !== value)) throw new Error('Invalid generated PNG signature.');
  const parts: Uint8Array[] = [bytes.slice(0, 8)];
  const metadata = new Set(['sRGB', 'gAMA', 'cHRM', 'pHYs', 'iCCP', 'eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
  let header = false, dataBytes = 0, end = false;
  for (let offset = 8; offset < bytes.length;) {
    if (bytes.length - offset < 12) throw new Error('Truncated generated PNG.');
    const length = view.getUint32(offset), next = offset + 12 + length;
    if (length > MAX_VARIANT_BYTES || next > bytes.length) throw new Error('Invalid generated PNG chunk length.');
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let crc = 0xffffffff;
    for (let index = offset + 4; index < next - 4; index++) crc = pngCrcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(next - 4)) throw new Error('Invalid generated PNG chunk CRC.');
    if (!header && name !== 'IHDR') throw new Error('Generated PNG must start with IHDR.');
    if (name === 'IHDR') {
      const body = offset + 8;
      if (header || length !== 13) throw new Error('Invalid generated PNG header.');
      const width = view.getUint32(body), height = view.getUint32(body + 4);
      if (!width || !height || width > 4096 || height > 4096 || width * height > 4 * 1024 * 1024 ||
        bytes[body + 8] !== 8 || ![2, 6].includes(bytes[body + 9]) || bytes[body + 10] !== 0 || bytes[body + 11] !== 0 || bytes[body + 12] !== 0) throw new Error('Generated PNG must be non-interlaced 8-bit RGB or RGBA.');
      header = true; parts.push(bytes.slice(offset, next));
    } else if (name === 'IDAT') {
      dataBytes += length; parts.push(bytes.slice(offset, next));
    } else if (name === 'IEND') {
      if (length || dataBytes < 6 || next !== bytes.length) throw new Error('Invalid generated PNG end.');
      end = true; parts.push(bytes.slice(offset, next));
    } else if (!metadata.has(name)) throw new Error('Unsupported generated PNG chunk: ' + name);
    offset = next;
  }
  if (!header || !end) throw new Error('Incomplete generated PNG.');
  return new Blob(parts.map(part => Uint8Array.from(part).buffer), { type: 'image/png' });
}

/** Read dimensions before allocating a decoded raster; the browser still validates the full file. */
export async function inspectImageSource(blob: Blob): Promise<{ width: number; height: number }> {
  if (!blob.size || blob.size > MAX_SOURCE_BYTES) throw new Error('Source image exceeds the 10 MiB limit.');
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  let width = 0, height = 0, mimeType = '';
  if (bytes.length >= 24 && bytes[0] === 137 && text(1, 7) === 'PNG\r\n\x1a\n' && text(12, 4) === 'IHDR') {
    mimeType = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    mimeType = 'image/webp';
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = text(offset, 4), size = view.getUint32(offset + 4, true), data = offset + 8;
      if (size > bytes.length - data) throw new Error('Truncated WebP source.');
      if (kind === 'VP8X' && size >= 10) {
        if (bytes[data] & 2) throw new Error('Animated images are not supported.');
        width = 1 + bytes[data + 4] + bytes[data + 5] * 256 + bytes[data + 6] * 65536;
        height = 1 + bytes[data + 7] + bytes[data + 8] * 256 + bytes[data + 9] * 65536;
        break;
      }
      if (kind === 'VP8 ' && size >= 10 && bytes[data + 3] === 157 && bytes[data + 4] === 1 && bytes[data + 5] === 42) {
        width = view.getUint16(data + 6, true) & 16383; height = view.getUint16(data + 8, true) & 16383; break;
      }
      if (kind === 'VP8L' && size >= 5 && bytes[data] === 47) {
        const bits = view.getUint32(data + 1, true);
        width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; break;
      }
      offset = data + size + (size % 2);
    }
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    mimeType = 'image/jpeg';
    for (let offset = 2; offset < bytes.length;) {
      if (bytes[offset++] !== 255) throw new Error('Invalid JPEG source.');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error('Truncated JPEG source.');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!mimeType || (blob.type && blob.type !== mimeType)) throw new Error('Source must be a PNG, JPEG or WebP image with matching MIME.');
  if (!width || !height || width > 8192 || height > 8192 || width * height > MAX_SOURCE_PIXELS) throw new Error('Source image exceeds the supported pixel dimensions.');
  return { width, height };
}

export interface PosterSlot { x: number; y: number; width: number; height: number; radius: number; }
export function posterStripLayout(count: number): PosterSlot[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 4) throw new Error('Select one to four distinct source images.');
  const width = count === 1 ? 120 : Math.min(60 + 140 / count, 90), height = count === 1 ? 160 : 140;
  const left = (400 - (count * width + (count - 1) * 4)) / 2;
  return Array.from({ length: count }, (_, index) => ({ x: left + index * (width + 4), y: (200 - height) / 2, width, height, radius: count === 1 ? 8 : 6 }));
}

export function imageOutputSizes(kind: GenerateImageVariantsOptions['kind'], dimensions: readonly { width: number; height: number }[]): { width: number; height: number }[] {
  if (!dimensions.length || dimensions.some(source => !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1)) throw new Error('Invalid source dimensions.');
  if (kind === 'media-sizes') {
    if (dimensions.length !== 1) throw new Error('A media size set needs its one original source.');
    const source = dimensions[0], ratio = source.height / source.width;
    const maximum = Math.floor(Math.min(source.width, 4096, 4096 / ratio, Math.sqrt(4 * 1024 * 1024 / ratio)));
    if (maximum < 1) throw new Error('Source aspect ratio cannot fit the output pixel limits.');
    const sizes = [160, 320, 640].filter(width => width <= maximum);
    return (sizes.length ? sizes : [maximum]).map(width => ({ width, height: Math.max(1, Math.round(width * ratio)) }));
  }
  const slots = posterStripLayout(dimensions.length);
  const maximum = Math.max(1, Math.floor(Math.min(1200, ...dimensions.map((source, index) => 400 * Math.min(source.width / slots[index].width, source.height / slots[index].height)))));
  const sizes = [400, 800, 1200].filter(width => width <= maximum);
  return (sizes.length ? sizes : [maximum]).map(width => ({ width, height: Math.max(1, Math.floor(width / 2)) }));
}

type DecodedImage = { image: CanvasImageSource; width: number; height: number; close: () => void };
async function decodeImage(blob: Blob, check: () => void, signal: AbortSignal): Promise<DecodedImage> {
  await inspectImageSource(blob); check();
  if (typeof createImageBitmap !== 'undefined') {
    const bitmap = await createImageBitmap(blob);
    try { check(); } catch (error) { bitmap.close(); throw error; }
    if (!bitmap.width || !bitmap.height || bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) { bitmap.close(); throw new Error('Decoded source image exceeds the supported pixel dimensions.'); }
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob), image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { image.onload = null; image.onerror = null; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve(); };
      const cancel = () => { image.src = ''; finish(abortError()); };
      image.onload = () => finish(); image.onerror = () => finish(new Error('Source image could not be decoded.'));
      signal.addEventListener('abort', cancel, { once: true });
      image.src = url;
      if (signal.aborted) cancel();
    });
    check();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width > 8192 || height > 8192 || width * height > MAX_SOURCE_PIXELS) throw new Error('Decoded source image exceeds the supported pixel dimensions.');
    return { image, width, height, close: () => { image.src = ''; URL.revokeObjectURL(url); } };
  } catch (error) { image.src = ''; URL.revokeObjectURL(url); throw error; }
}

function roundedRect(context: CanvasRenderingContext2D, slot: PosterSlot): void {
  const { x, y, width, height, radius } = slot;
  context.beginPath(); context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius); context.closePath();
}

function renderImage(canvas: HTMLCanvasElement, kind: GenerateImageVariantsOptions['kind'], sources: DecodedImage[]): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable.');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  if (kind === 'media-sizes') { context.drawImage(sources[0].image, 0, 0, canvas.width, canvas.height); return; }
  context.scale(canvas.width / 400, canvas.height / 200);
  const slots = posterStripLayout(sources.length);
  sources.forEach((source, index) => {
    const slot = slots[index];
    context.save();
    if (sources.length > 1) {
      roundedRect(context, slot); context.shadowColor = 'rgba(0,0,0,0.3)'; context.shadowBlur = 12; context.shadowOffsetY = 4;
      context.fillStyle = '#fff'; context.fill(); context.shadowColor = 'transparent';
    }
    roundedRect(context, slot); context.clip();
    const scale = Math.max(slot.width / source.width, slot.height / source.height);
    const width = slot.width / scale, height = slot.height / scale;
    context.drawImage(source.image, (source.width - width) / 2, (source.height - height) / 2, width, height, slot.x, slot.y, slot.width, slot.height);
    context.restore(); roundedRect(context, slot); context.lineWidth = 2;
    context.strokeStyle = sources.length === 1 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.2)'; context.stroke();
  });
}

async function encode(canvas: HTMLCanvasElement, check: () => void): Promise<Blob> {
  for (const quality of [0.86, 0.78, 0.70, 0.62]) {
    check();
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed.')), 'image/webp', quality));
    check();
    // Browsers without WebP encoding return PNG; the backend validates both full rasters.
    if (!['image/webp', 'image/png'].includes(blob.type)) throw new Error('Browser returned an unsupported image encoding.');
    if (blob.size > 0 && blob.size <= MAX_VARIANT_BYTES) {
      const output = blob.type === 'image/png' ? await normalizeGeneratedPng(blob) : blob;
      check(); return output;
    }
    if (blob.type === 'image/png') break;
  }
  throw new Error('Generated image exceeds the 1 MiB per-size limit. Choose smaller source images.');
}

export async function generateImageVariants(options: GenerateImageVariantsOptions): Promise<GeneratedImageSet> {
  const { kind, fetchSource, assertContext = () => {}, seed } = options;
  if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647)) throw new Error('Image selection seed must be an integer between 0 and 2147483647.');
  const sources = options.sources.map(source => ({ ...source }));
  if (!['timeline-composite', 'media-sizes'].includes(kind) || !sources.length || sources.length > (kind === 'media-sizes' ? 1 : 4) ||
    new Set(sources.map(source => source.id)).size !== sources.length || sources.some(source => !Number.isSafeInteger(source.id) || source.id <= 0 || !source.url || typeof source.stamp !== 'string' || !source.stamp)) throw new Error('Select valid, distinct image sources with current stamps.');
  const controller = new AbortController(), abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const check = () => { if (controller.signal.aborted) throw abortError(); assertContext(); };
  const decoded: DecodedImage[] = [];
  try {
    check();
    const pending = sources.map(source => imageRequestQueue.run(async () => {
      check(); const blob = await fetchSource(source, controller.signal); check();
      const image = await decodeImage(blob, check, controller.signal); decoded.push(image); return image;
    }, controller.signal));
    let images: DecodedImage[];
    try { images = await Promise.all(pending); }
    catch (error) { controller.abort(); await Promise.allSettled(pending); throw error; }
    const variants: GeneratedImageVariant[] = [];
    for (const size of imageOutputSizes(kind, images)) {
      check();
      const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
      try {
        renderImage(canvas, kind, images);
        const blob = await encode(canvas, check);
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); check();
        const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
        variants.push({ ...size, name: `w${size.width}`, mimeType: blob.type as GeneratedImageVariant['mimeType'], byteLength: blob.size, sha256, blob });
      } finally { canvas.width = 0; canvas.height = 0; }
    }
    if (variants.reduce((total, variant) => total + variant.byteLength, 0) > MAX_SET_BYTES) throw new Error('Generated image set exceeds the 3 MiB limit.');
    return { recipe: { template: kind === 'timeline-composite' ? 'poster-strip-v1' : 'media-sizes-v1', sourceIds: sources.map(source => source.id), ...(seed !== undefined ? { seed } : {}) }, sources, variants };
  } finally {
    controller.abort(); options.signal?.removeEventListener('abort', abort);
    decoded.forEach(image => image.close());
  }
}
