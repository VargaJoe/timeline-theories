export interface PosterSlot { x: number; y: number; width: number; height: number; radius: number; }
export const MAX_POSTER_SOURCES: 12;
export function posterStripLayout(count: number): PosterSlot[];
