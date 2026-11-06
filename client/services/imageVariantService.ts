import { environment } from '../configuration';
import { applyNativeCommands, acknowledgeNativeCommands, nativeCoverPayload, nativeRequest, nativeResponse, nativeSnapshot, type NativeCommand, type NativeSnapshot } from './nativeApi';
import { assertOperations, captureOperationContext } from './sensenet';
import type { GeneratedImageSet, ImageGenerationSource } from '../utils/imageGenerator';
import type { ImageDescriptor } from '../utils/imageVariants';

export interface ImagePresentation extends ImageDescriptor { setId?: number; recipe?: GeneratedImageSet['recipe']; }
export interface ImageCapabilities { available: boolean; protocol?: string; }
export const imageCapabilities = async (signal?: AbortSignal) =>
  nativeRequest<ImageCapabilities>('/images/capabilities', { signal });
export const imagePresentation = async (id: number, signal?: AbortSignal, editor = false) =>
  nativeRequest<ImagePresentation>(`/content/${id}/image-presentation${editor ? '/editor' : ''}`, { signal });
export interface ImageSetSummary { setId: number; generationId?: string; state: string; deletable: boolean; }
export const imageSets = (ownerId: number, signal?: AbortSignal) => nativeRequest<ImageSetSummary[]>(`/content/${ownerId}/image-sets`, { signal });
export const deleteImageSet = (ownerId: number, setId: number, key: string) => post(`/images/drafts/${setId}/delete`, { ownerId }, key);

export async function sourceForGeneration(id: number, signal: AbortSignal): Promise<ImageGenerationSource> {
  signal.throwIfAborted();
  const source = await nativeSnapshot(id, { refresh: true });
  signal.throwIfAborted();
  const binary = source.CoverImageBin as { ContentType?: string } | undefined;
  if (!binary || !['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'].includes(binary.ContentType || '')) throw new Error('Upload an original cover in the media editor before preparing image sizes.');
  return { id, url: `/api/v1/content/${id}/cover` };
}
export async function originalImageBlob(source: ImageGenerationSource, signal: AbortSignal): Promise<Blob> {
  const response = await nativeResponse(`/content/${source.id}/cover`, { signal });
  if (!response.ok) throw new Error('The original cover is unavailable with your current permissions.');
  return response.blob();
}
async function post<T>(path: string, body: unknown, key: string, signal?: AbortSignal): Promise<T> {
  return nativeRequest<T>(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key }, signal });
}
async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(text);
}

/** Retain this instance on retry: each uncertain step uses the same exact request key. */
export class ImagePublication {
  readonly generationId = crypto.randomUUID();
  readonly ownerId: number;
  readonly generated: GeneratedImageSet;
  readonly kind: 'timeline-composite' | 'media-sizes';
  private owner?: NativeSnapshot;
  private setId?: number;
  private uploaded: Record<string, unknown>[] = [];
  private sealed = false;
  private completed?: NativeSnapshot;
  private readonly checkContext = captureOperationContext();
  constructor(ownerId: number, generated: GeneratedImageSet, kind: 'timeline-composite' | 'media-sizes', owner: NativeSnapshot) {
    this.ownerId = ownerId; this.generated = generated; this.kind = kind; this.owner = owner;
  }

  async publish(signal: AbortSignal, progress: (message: string) => void): Promise<NativeSnapshot> {
    const check = () => { this.checkContext(); signal.throwIfAborted(); };
    check();
    if (this.completed) return this.completed;
    await assertOperations([{ target: this.ownerId, action: 'update' }, ...this.generated.sources.map(source => ({ target: source.id, action: 'read' as const }))]);
    check();
    this.owner ??= await nativeSnapshot(this.ownerId, { refresh: true });
    if (!this.setId) {
      progress('Preparing a new image set…');
      const manifest = { schemaVersion: 1, kind: this.kind, projectPath: environment.projectRoot,
        ownerId: this.ownerId, generationId: this.generationId, sourceIds: this.generated.sources.map(source => source.id),
        recipe: this.generated.recipe, sourceStamps: this.generated.sources.map(source => ({ id: source.id, stamp: source.stamp })), variants: [] };
      const draft = await post<{ setId: number; ownerRevision: string }>('/images/drafts', { ownerId: this.ownerId, generationId: this.generationId, expectedRevision: this.owner.revision, manifest }, `${this.generationId}:draft`, signal);
      if (!Number.isSafeInteger(draft.setId) || draft.setId < 1 || typeof draft.ownerRevision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(draft.ownerRevision)) throw new Error('The image service returned an invalid draft. Retry this same publication.');
      this.setId = draft.setId;
      this.owner = { ...this.owner, revision: draft.ownerRevision };
    }
    for (let index = this.uploaded.length; index < this.generated.variants.length; index++) {
      check();
      const { blob, ...variant } = this.generated.variants[index];
      progress(`Uploading image ${index + 1} of ${this.generated.variants.length}…`);
      const file = await post<Record<string, unknown>>(`/images/drafts/${this.setId}/variants/${variant.name}`, {
        ownerId: this.ownerId, variant, bytesBase64: await base64(blob),
      }, `${this.generationId}:${variant.name}`, signal);
      this.uploaded.push(file);
    }
    if (!this.sealed) {
      check();
      progress('Checking the complete image set…');
      await post(`/images/drafts/${this.setId}/seal`, { ownerId: this.ownerId, variants: this.uploaded }, `${this.generationId}:seal`, signal);
      this.sealed = true;
    }
    check(); progress('Publishing…');
    const commands = [{ action: 'cover-presentation', targetId: this.ownerId, expectedRevision: this.owner.revision, setId: this.setId }];
    await applyNativeCommands(commands, check);
    const current = await nativeSnapshot(this.ownerId, { refresh: true });
    check(); this.completed = current; acknowledgeNativeCommands(commands);
    return current;
  }
}

export async function restoreOriginalPresentation(ownerId: number): Promise<NativeSnapshot> {
  const checkContext = captureOperationContext();
  const owner = await nativeSnapshot(ownerId, { refresh: true });
  const commands = [{ action: 'cover-presentation', targetId: ownerId, expectedRevision: owner.revision, setId: null }];
  await applyNativeCommands(commands, checkContext);
  const current = await nativeSnapshot(ownerId, { refresh: true });
  checkContext(); acknowledgeNativeCommands(commands);
  return current;
}

/** Uses the existing original-cover writer without resizing the selected file. */
export class OriginalImageUpload {
  private command?: NativeCommand;
  private completed?: NativeSnapshot;
  private readonly checkContext = captureOperationContext();
  private readonly ownerId: number;
  private readonly file: File;
  constructor(ownerId: number, file: File) { this.ownerId = ownerId; this.file = file; }
  async upload(signal: AbortSignal): Promise<NativeSnapshot> {
    const check = () => { this.checkContext(); signal.throwIfAborted(); };
    check(); if (this.completed) return this.completed;
    if (!this.command) {
      await assertOperations([{ target: this.ownerId, action: 'upload' }]);
      const owner = await nativeSnapshot(this.ownerId, { refresh: true }); check();
      const payload = await nativeCoverPayload(this.file, this.file.name); check();
      this.command = { action: 'cover', targetId: this.ownerId, expectedRevision: owner.revision, ...payload };
    }
    await applyNativeCommands([this.command], check);
    const current = await nativeSnapshot(this.ownerId, { refresh: true }); check();
    this.completed = current; acknowledgeNativeCommands([this.command]); return current;
  }
}
