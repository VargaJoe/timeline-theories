export const MAX_POSTER_SOURCES = 12;

/** Pixel layout of the saved poster-strip-v1 raster, in its 400 x 200 design space. */
export function posterStripLayout(count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_POSTER_SOURCES) throw new Error(`Select one to ${MAX_POSTER_SOURCES} distinct source images.`);
  if (count > 4) {
    // Keep complete faces in two rows of the same atlas. Display cards may
    // overlap, but overlapping saved pixels would hide artwork on hover.
    const columns = Math.ceil(count / 2), width = 56, height = 82, gap = 8;
    return Array.from({ length: count }, (_, index) => {
      const row = Math.floor(index / columns), rowCount = row ? count - columns : columns;
      const left = (400 - (rowCount * width + (rowCount - 1) * gap)) / 2;
      return { x: left + (index % columns) * (width + gap), y: 12 + row * 94, width, height, radius: 4 };
    });
  }
  // Published 1–4 poster sets depend on these exact crop coordinates.
  const width = count === 1 ? 120 : Math.min(60 + 140 / count, 90), height = count === 1 ? 160 : 140;
  const left = (400 - (count * width + (count - 1) * 4)) / 2;
  return Array.from({ length: count }, (_, index) => ({ x: left + index * (width + 4), y: (200 - height) / 2, width, height, radius: count === 1 ? 8 : 6 }));
}
