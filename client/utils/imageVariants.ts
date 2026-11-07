export interface ImageVariant {
  name: string;
  width: number;
  height: number;
  url: string;
  mimeType?: string;
  byteLength?: number;
}

/** A non-legacy state must never silently reveal an original or an old set. */
export interface ImageDescriptor {
  state: 'active' | 'stale' | 'blocked' | 'missing' | 'legacy';
  generationId?: string;
  variants?: ImageVariant[];
  layout?: { template: 'poster-strip-v1'; count: number };
}

/** Public layout hints contain no source identities or editor reconstruction metadata. */
export function posterStripCount(image: ImageDescriptor | undefined): number | undefined {
  const layout = image?.state === 'active' ? image.layout : undefined;
  return layout?.template === 'poster-strip-v1' && Number.isSafeInteger(layout.count) && layout.count >= 1 && layout.count <= 4
    ? layout.count : undefined;
}

export function selectImageVariant(variants: readonly ImageVariant[], slotWidth: number, devicePixelRatio = 1): ImageVariant | undefined {
  if (!Number.isFinite(slotWidth) || slotWidth <= 0) return undefined;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.min(devicePixelRatio, 2) : 1;
  const ordered = variants.filter(variant => Number.isSafeInteger(variant.width) && variant.width > 0 &&
    Number.isSafeInteger(variant.height) && variant.height > 0 && typeof variant.url === 'string' && variant.url.length > 0)
    .slice().sort((a, b) => a.width - b.width);
  return ordered.find(variant => variant.width >= slotWidth * dpr) ?? ordered.at(-1);
}

export function selectImageUrl(image: ImageDescriptor | undefined, legacySrc: string, slotWidth: number, devicePixelRatio = 1): string | undefined {
  if (!image || image.state === 'legacy') return legacySrc || undefined;
  return image.state === 'active' ? selectImageVariant(image.variants ?? [], slotWidth, devicePixelRatio)?.url : undefined;
}
