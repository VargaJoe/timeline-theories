import type JSZip from 'jszip';
export const TSV_COLUMNS: readonly string[];
export const EXCHANGE_LIMITS: Readonly<{ archiveBytes: number; totalBytes: number; tsvBytes: number; coverBytes: number; rows: number; files: number; compressionRatio: number }>;
export interface ParsedTimelineEntry { entryName: string; Title: string; Description: string; MediaType: string; mediaId: string; coverImageFilename: string; ChronologicalDate: string; Position: number; Notes: string; EntryLabel: string; Importance: string; ChronologicalDescription: string; Author: string; Publisher: string; ISBN: string; PublicationYear: number; Genre: string[]; Tags: string[]; }
export interface ExchangeStats { entriesCount: number; coversCount: number; archiveBytes: number; uncompressedBytes: number; skippedImagesCount?: number; }
export function escapeTSVField(value: unknown): string;
export function unescapeTSVField(value: string): string;
export function coverFilename(value: string): string;
export function parseTSV(content: string): { timelineName: string; entries: ParsedTimelineEntry[] };
export function entryFieldsFromRow(row: ParsedTimelineEntry, options?: { displayName?: string; choices?: Record<string, string[]> }): Record<string, unknown>;
export function normalizeExchangeEntry(entry: object): { name?: string; displayName?: string; mediaItem: Record<string, unknown> | null; position?: number; chronologicalDate?: string; chronologicalDescription?: string; notes?: string; entryLabel?: string; importance?: string };
export function buildTSV(entries: readonly object[], timelineName: string, coverFilenames?: Map<number, string>): string;
export function getExtensionFromContentType(type?: string): string;
export function coverMimeType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp';
export function exportFilename(timelineName: string, now?: Date): string;
export function inspectArchive(bytes: Uint8Array): { files: Map<string, { size: number; limit: number; crc: number }>; totalBytes: number };
export function decodeTimelineArchive(zip: typeof JSZip, input: Uint8Array | ArrayBuffer | Blob): Promise<{ timelineName: string; entries: ParsedTimelineEntry[]; covers: Map<string, Uint8Array>; stats: ExchangeStats }>;
export function encodeTimelineArchive(zip: typeof JSZip, timelineName: string, entries: readonly object[], readCover: (media: Record<string, unknown>, entry: object, index: number) => Promise<{ data: Uint8Array | ArrayBuffer | Blob; contentType?: string } | null>): Promise<{ bytes: Uint8Array; filename: string; skippedImagesCount: number; stats: ExchangeStats }>;
