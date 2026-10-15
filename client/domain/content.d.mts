export class DomainError extends Error { code: string; status: number; details?: unknown; constructor(code: string, message: string, status?: number, details?: unknown); }
export const TYPES: string[];
export const FIELDS: Record<string, string[]>;
export const CHOICES: Record<string, string[]>;
export function assertObject(value: unknown): void;
export function assertId(value: unknown): number;
export function safeName(value: unknown): string;
export function validateFields(type: string, input: Record<string, unknown>, options?: { create?: boolean; choices?: Record<string, string[]> }): Record<string, unknown>;
export function validatePublicUrl(value: string): URL;
export function projectPaths(root: string): { root: string; timelines: string; media: string };
export function assertMembership(content: Record<string, unknown>, paths: ReturnType<typeof projectPaths>, options?: { parent?: boolean; type?: string }): Record<string, unknown>;
export function fieldDiff(before: Record<string, unknown>, fields: Record<string, unknown>): { field: string; before: unknown; after: unknown }[];
export function metadataDiff(content: Record<string, unknown>, proposal: Record<string, unknown>, options?: { overwrite?: boolean; choices?: Record<string, string[]> }): { fields: Record<string, unknown>; diff: ReturnType<typeof fieldDiff>; sources: unknown[]; protected: string[] };
