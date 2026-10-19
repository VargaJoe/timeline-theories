import { acknowledgeNativeCommands, applyNativeCommands, cachedNativeSnapshot, nativeCoverPayload, nativeRequest, nativeSnapshot } from './nativeApi';
import type { NativeApplyResult, NativeCommand, NativeCoverPayload } from './nativeApi';
import { metadataDiff } from '../domain/content.mjs';
import { assertOperations, captureOperationContext } from './sensenet';
import { resizeImageToDefault } from './mediaLibraryService';
import type { MediaItem } from './mediaLibraryService';

// Rate limiting interfaces
export interface RateLimitInfo {
  isLimited: boolean;
  retryAfter?: number; // seconds to wait
  remaining?: number;
  resetTime?: Date;
  source: DataSourceType;
}

export interface ApiError extends Error {
  status?: number;
  rateLimitInfo?: RateLimitInfo;
}

export interface MetadataSource { url: string; note: string; confidence: number; }
export interface MetadataProposal extends Record<string, unknown> { fields: Record<string, unknown>; sources: MetadataSource[]; }

export interface MediaUpdateData {
  title?: string;
  year?: number;
  description?: string;
  coverImageUrl?: string;
  releaseDate?: string;
  runtime?: number;
  genres?: string[];
  source?: string; // Which source was used for the data
  sources?: MetadataSource[];
  _binaryCoverImageUploaded?: boolean; // Internal flag for binary upload
}

export interface MediaUpdateResult {
  mediaItem: MediaItem;
  updateData: MediaUpdateData | null;
  error?: string;
  hasChanges: boolean;
  proposal?: MetadataProposal;
  expectedRevision?: string;
  overwrite?: boolean;
  binaryCoverUrl?: string;
  binaryCover?: NativeCoverPayload;
}

export interface UpdateOptions {
  updateTitles: boolean;
  updateDescriptions: boolean;
  updateCoverImages: boolean;
  onlyMissing: boolean; // true = only update empty fields, false = overwrite all
  preferredSources: DataSourceType[]; // Order of preferred sources
}

// Supported data sources
export const DataSource = {
  IMDB: 'imdb',
  TVDB: 'tvdb', 
  TMDB: 'tmdb',
  TRAKT: 'trakt',
  OMDB: 'omdb'
} as const;

export type DataSourceType = typeof DataSource[keyof typeof DataSource];

// Interface for enhanced progress reporting with API status
export interface BulkUpdateProgress {
  current: number;
  total: number;
  currentItem: string;
  apiStatus?: {
    source: string;
    status: 'active' | 'rate-limited' | 'failed';
    message?: string;
    retryAfter?: number;
  };
}

// Type for enhanced progress callback
export type ProgressCallback = (progress: BulkUpdateProgress) => void;

export class MediaUpdateService {
  private static rateLimitState: Map<DataSourceType, RateLimitInfo> = new Map();

  /** Preference, identity validation, fallback and bounded retry run on the gateway. */
  static async fetchUpdateData(mediaItem: MediaItem, options?: UpdateOptions): Promise<MediaUpdateData | null> {
    try {
      const data = await nativeRequest<MediaUpdateData | null>('/api/v1/providers/media/lookup', {
        method: 'POST',
        body: JSON.stringify({
          mediaItem: {
            Id: mediaItem.Id, DisplayName: mediaItem.DisplayName, Title: mediaItem.Title,
            Subtitle: mediaItem.Subtitle, MediaType: mediaItem.MediaType, ExternalLinks: mediaItem.ExternalLinks,
          },
          preferredSources: options?.preferredSources,
        }),
      });
      if (data?.source) this.rateLimitState.delete(data.source.toLowerCase().split(' ')[0] as DataSourceType);
      return data;
    } catch (error) {
      const apiError = error as ApiError & { source?: DataSourceType; retryAfter?: number };
      if (apiError.status === 429 && apiError.source) {
        const retryAfter = apiError.retryAfter ?? 1;
        const info: RateLimitInfo = {
          isLimited: true, source: apiError.source, retryAfter,
          resetTime: new Date(Date.now() + retryAfter * 1000),
        };
        this.rateLimitState.set(info.source, info);
        apiError.rateLimitInfo = info;
      }
      throw error;
    }
  }
  private static metadataSources(data: MediaUpdateData): MetadataSource[] {
    if (data.sources?.length) return data.sources.map(source => ({ ...source }));
    const source = data.source?.toLowerCase().split(' ')[0];
    const legacyUrls: Record<string, string> = {
      omdb: 'https://www.omdbapi.com/', imdb: 'https://www.imdb.com/',
      tmdb: 'https://www.themoviedb.org/', trakt: 'https://trakt.tv/',
    };
    if (!source || !legacyUrls[source]) throw new Error('The metadata provider did not include a source and uncertainty note');
    return [{ url: legacyUrls[source], confidence: 0.5, note: 'Legacy provider result. The adapter did not include a target URL and this metadata has not been independently verified.' }];
  }

  private static fieldsFromChanges(data: MediaUpdateData): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    if (data.title) fields.DisplayName = data.title;
    if (data.description) fields.Description = data.description;
    if (data.year !== undefined) fields.Year = data.year;
    if (data.coverImageUrl) fields.CoverImageUrl = data.coverImageUrl;
    return fields;
  }

  /** The browser and gateway use the same missing-only and protected-field rules. */
  static analyzeChanges(mediaItem: MediaItem, updateData: MediaUpdateData, options: UpdateOptions & { coverImageMode?: 'url' | 'binary' }): MediaUpdateData | null {
    const selected: Record<string, unknown> = {};
    if (options.updateTitles && updateData.title) selected.DisplayName = updateData.title;
    if (options.updateTitles && updateData.year !== undefined) selected.Year = updateData.year;
    if (options.updateDescriptions && updateData.description) selected.Description = updateData.description;
    if (options.updateCoverImages && updateData.coverImageUrl) selected.CoverImageUrl = updateData.coverImageUrl;
    if (!Object.keys(selected).length) return null;
    const type = cachedNativeSnapshot(mediaItem.Id)?.Type || (mediaItem.MediaType === 'book' ? 'BookMediaItem' : 'MediaItem');
    const result = metadataDiff({ ...mediaItem, Type: type }, { fields: selected, sources: this.metadataSources(updateData) }, { overwrite: !options.onlyMissing });
    const fields = Object.fromEntries(result.diff.map(change => [change.field, change.after]));
    const binaryConversion = options.coverImageMode === 'binary' && Object.hasOwn(result.fields, 'CoverImageUrl');
    if (!result.diff.length && !binaryConversion) return null;
    return {
      ...(typeof fields.DisplayName === 'string' ? { title: fields.DisplayName } : {}),
      ...(typeof fields.Description === 'string' ? { description: fields.Description } : {}),
      ...(typeof fields.Year === 'number' ? { year: fields.Year } : {}),
      ...(typeof fields.CoverImageUrl === 'string' || binaryConversion ? { coverImageUrl: updateData.coverImageUrl } : {}),
      source: updateData.source,
      sources: result.sources as MetadataSource[],
    };
  }

  /** Check the entire batch before the first provider request, including preview. */
  static async processBulkUpdate(
    mediaItems: MediaItem[],
    options: UpdateOptions & { coverImageMode?: 'url' | 'binary' },
    onProgress?: ProgressCallback,
    isPreview: boolean = true
  ): Promise<MediaUpdateResult[]> {
    const checkContext = captureOperationContext();
    const selectedItems = mediaItems.map(item => ({ ...item }));
    const selectedOptions = { ...options, preferredSources: [...options.preferredSources] };
    const operations = selectedItems.flatMap(item => [
      { target: item.Id, action: 'update' as const },
      ...(selectedOptions.updateCoverImages && selectedOptions.coverImageMode === 'binary' ? [{ target: item.Id, action: 'upload' as const }] : []),
    ]);
    await assertOperations(operations);
    checkContext();
    const revisions = new Map<number, string>();
    for (const item of selectedItems) {
      const snapshot = await nativeSnapshot(item.Id);
      checkContext(); revisions.set(item.Id, snapshot.revision);
    }
    const results: MediaUpdateResult[] = [];
    for (const [index, mediaItem] of selectedItems.entries()) {
      checkContext();
      const progress: BulkUpdateProgress = { current: index + 1, total: selectedItems.length, currentItem: mediaItem.DisplayName || 'Unknown' };
      onProgress?.(progress);
      try {
        const updateData = await this.fetchUpdateData(mediaItem, selectedOptions);
        checkContext();
        if (!updateData) { results.push({ mediaItem, updateData: null, hasChanges: false, error: 'No data found' }); continue; }
        if (updateData.source) {
          progress.apiStatus = { source: updateData.source, status: 'active', message: `Successfully fetched from ${updateData.source}` };
          onProgress?.(progress);
        }
        const changes = this.analyzeChanges(mediaItem, updateData, selectedOptions);
        if (!changes) { results.push({ mediaItem, updateData: null, hasChanges: false }); continue; }
        const fields = this.fieldsFromChanges(changes);
        const binaryCoverUrl = selectedOptions.coverImageMode === 'binary' ? changes.coverImageUrl : undefined;
        const binaryCover = binaryCoverUrl ? await nativeCoverPayload(await resizeImageToDefault(binaryCoverUrl), 'cover.jpg') : undefined;
        checkContext();
        if (binaryCoverUrl) fields.CoverImageUrl = '';
        results.push({
          mediaItem, updateData: changes, hasChanges: true,
          expectedRevision: revisions.get(mediaItem.Id), overwrite: !selectedOptions.onlyMissing,
          proposal: { fields, sources: changes.sources! }, binaryCoverUrl, binaryCover,
        });
      } catch (error) {
        checkContext();
        const apiError = error as ApiError;
        progress.apiStatus = {
          source: 'API', status: apiError.status === 429 ? 'rate-limited' : 'failed',
          message: error instanceof Error ? error.message : 'Metadata request failed',
          retryAfter: apiError.rateLimitInfo?.retryAfter,
        };
        onProgress?.(progress);
        results.push({ mediaItem, updateData: null, error: progress.apiStatus.message, hasChanges: false });
      }
    }
    if (isPreview) return results;
    const approved = results.filter(result => result.hasChanges);
    const applied = await this.applyApprovedUpdates(approved, onProgress);
    const finalById = new Map(applied.map(result => [result.mediaItem.Id, result]));
    return results.map(result => finalById.get(result.mediaItem.Id) || result);
  }

  /** Apply exactly the reviewed proposal. Provider metadata is never fetched again here. */
  static async applyApprovedUpdates(results: MediaUpdateResult[], onProgress?: ProgressCallback): Promise<MediaUpdateResult[]> {
    const checkContext = captureOperationContext();
    const approved = results.filter(result => result.hasChanges).map(result => ({
      ...result, mediaItem: { ...result.mediaItem },
      proposal: result.proposal ? structuredClone(result.proposal) : undefined,
      updateData: result.updateData ? structuredClone(result.updateData) : null,
      binaryCover: result.binaryCover ? structuredClone(result.binaryCover) : undefined,
    }));
    if (!approved.length) return [];
    for (const result of approved) {
      if (!result.proposal || !result.expectedRevision) throw new Error('Metadata has no reviewed proposal and revision; generate a new preview');
      if (result.binaryCoverUrl && !result.binaryCover) throw new Error('The binary cover has no reviewed image bytes; generate a new preview');
      const type = cachedNativeSnapshot(result.mediaItem.Id)?.Type || (result.mediaItem.MediaType === 'book' ? 'BookMediaItem' : 'MediaItem');
      metadataDiff({ ...result.mediaItem, Type: type }, result.proposal, { overwrite: result.overwrite === true });
    }
    await assertOperations(approved.flatMap(result => [
      { target: result.mediaItem.Id, action: 'update' as const },
      ...(result.binaryCoverUrl ? [{ target: result.mediaItem.Id, action: 'upload' as const }] : []),
    ]));
    checkContext();
    const commands: NativeCommand[] = [];
    for (const [index, result] of approved.entries()) {
      checkContext();
      onProgress?.({ current: index + 1, total: approved.length, currentItem: result.mediaItem.DisplayName });
      const cover = result.binaryCover;
      checkContext();
      commands.push({ action: 'metadata', targetId: result.mediaItem.Id, expectedRevision: result.expectedRevision,
        proposal: result.proposal, overwrite: result.overwrite === true, ...(cover ? { cover } : {}) });
    }
    let receipt: NativeApplyResult;
    try { receipt = await applyNativeCommands(commands, checkContext); }
    catch (error) {
      const partial = (error as { applyResult?: NativeApplyResult }).applyResult;
      if (!partial) throw error;
      receipt = partial;
    }
    checkContext();
    const completedIds = new Set(receipt.completed.map(item => item.result.id));
    const message = typeof receipt.error === 'string' ? receipt.error : receipt.error?.message || 'Metadata was not applied';
    const finalResults = approved.map(result => completedIds.has(result.mediaItem.Id) ? {
      ...result, error: undefined, updateData: result.updateData ? { ...result.updateData, ...(result.binaryCoverUrl ? { _binaryCoverImageUploaded: true } : {}) } : null,
    } : { ...result, hasChanges: false, error: message });
    if (receipt.ok) acknowledgeNativeCommands(commands);
    return finalResults;
  }
  static getRateLimitStatus(): Map<DataSourceType, RateLimitInfo> {
    return new Map(this.rateLimitState);
  }
}
