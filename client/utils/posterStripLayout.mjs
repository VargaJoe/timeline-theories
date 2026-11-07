/** Pixel layout of the saved poster-strip-v1 raster, in its 400 x 200 design space. */
export function posterStripLayout(count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 4) throw new Error('Select one to four distinct source images.');
  const width = count === 1 ? 120 : Math.min(60 + 140 / count, 90), height = count === 1 ? 160 : 140;
  const left = (400 - (count * width + (count - 1) * 4)) / 2;
  return Array.from({ length: count }, (_, index) => ({ x: left + index * (width + 4), y: (200 - height) / 2, width, height, radius: count === 1 ? 8 : 6 }));
}
