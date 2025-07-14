import { MediaLibraryService } from './mediaLibraryService';
import type { MediaItem } from './mediaLibraryService';

export interface MediaUpdateData {
  title?: string;
  description?: string;
  coverImageUrl?: string;
  releaseDate?: string;
  runtime?: number;
  genres?: string[];
}

export interface MediaUpdateResult {
  mediaItem: MediaItem;
  updateData: MediaUpdateData | null;
  error?: string;
  hasChanges: boolean;
}

export interface UpdateOptions {
  updateTitles: boolean;
  updateDescriptions: boolean;
  updateCoverImages: boolean;
  onlyMissing: boolean; // true = only update empty fields, false = overwrite all
}

export class MediaUpdateService {
  /**
   * Fetch updated data for a single media item from Trakt
   * Note: This is a placeholder implementation. In a real app, this would
   * integrate with Trakt API to fetch updated media details.
   */
  static async fetchUpdateData(mediaItem: MediaItem): Promise<MediaUpdateData | null> {
    try {
      // For now, return null as we need to implement actual Trakt API integration
      // TODO: Implement Trakt API calls to fetch updated media details
      console.log('Fetching update data for:', mediaItem.DisplayName);
      return null;

    } catch (error) {
      console.error('Error fetching update data for media item:', mediaItem.Id, error);
      return null;
    }
  }

  /**
   * Analyze what would change for a media item given update data and options
   */
  static analyzeChanges(
    mediaItem: MediaItem, 
    updateData: MediaUpdateData, 
    options: UpdateOptions
  ): { hasChanges: boolean; changes: Partial<MediaUpdateData> } {
    const changes: Partial<MediaUpdateData> = {};
    let hasChanges = false;

    // Check title changes
    if (options.updateTitles && updateData.title) {
      const shouldUpdate = options.onlyMissing 
        ? !mediaItem.DisplayName || mediaItem.DisplayName.trim() === ''
        : true;
      
      if (shouldUpdate && updateData.title !== mediaItem.DisplayName) {
        changes.title = updateData.title;
        hasChanges = true;
      }
    }

    // Check description changes
    if (options.updateDescriptions && updateData.description) {
      const shouldUpdate = options.onlyMissing 
        ? !mediaItem.Description || mediaItem.Description.trim() === ''
        : true;
      
      if (shouldUpdate && updateData.description !== mediaItem.Description) {
        changes.description = updateData.description;
        hasChanges = true;
      }
    }

    // Check cover image changes
    if (options.updateCoverImages && updateData.coverImageUrl) {
      const shouldUpdate = options.onlyMissing 
        ? !mediaItem.CoverImageUrl || mediaItem.CoverImageUrl.trim() === ''
        : true;
      
      if (shouldUpdate && updateData.coverImageUrl !== mediaItem.CoverImageUrl) {
        changes.coverImageUrl = updateData.coverImageUrl;
        hasChanges = true;
      }
    }

    return { hasChanges, changes };
  }

  /**
   * Apply updates to a media item
   */
  static async applyUpdate(mediaItem: MediaItem, changes: Partial<MediaUpdateData>): Promise<void> {
    const updateData: Partial<MediaItem> = {};

    if (changes.title) updateData.DisplayName = changes.title;
    if (changes.description) updateData.Description = changes.description;
    if (changes.coverImageUrl) updateData.CoverImageUrl = changes.coverImageUrl;
    if (changes.releaseDate) updateData.ReleaseDate = changes.releaseDate;
    if (changes.runtime) updateData.Duration = changes.runtime;
    if (changes.genres) updateData.Genre = changes.genres.join(', ');

    await MediaLibraryService.updateMediaItem(mediaItem.Id, updateData);
  }

  /**
   * Process bulk updates for multiple media items
   */
  static async processBulkUpdate(
    mediaItems: MediaItem[],
    options: UpdateOptions,
    onProgress?: (current: number, total: number, item: MediaItem) => void
  ): Promise<MediaUpdateResult[]> {
    const results: MediaUpdateResult[] = [];

    for (let i = 0; i < mediaItems.length; i++) {
      const mediaItem = mediaItems[i];
      
      if (onProgress) {
        onProgress(i + 1, mediaItems.length, mediaItem);
      }

      try {
        // Fetch update data
        const updateData = await this.fetchUpdateData(mediaItem);
        
        if (!updateData) {
          results.push({
            mediaItem,
            updateData: null,
            error: 'No data found on Trakt',
            hasChanges: false
          });
          continue;
        }

        // Analyze changes
        const { hasChanges, changes } = this.analyzeChanges(mediaItem, updateData, options);

        results.push({
          mediaItem,
          updateData: changes,
          hasChanges
        });

      } catch (error) {
        results.push({
          mediaItem,
          updateData: null,
          error: error instanceof Error ? error.message : 'Unknown error',
          hasChanges: false
        });
      }
    }

    return results;
  }

  /**
   * Apply bulk updates after user confirmation
   */
  static async applyBulkUpdates(
    results: MediaUpdateResult[],
    onProgress?: (current: number, total: number, item: MediaItem) => void
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    const itemsToUpdate = results.filter(r => r.hasChanges && r.updateData);
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < itemsToUpdate.length; i++) {
      const result = itemsToUpdate[i];
      
      if (onProgress) {
        onProgress(i + 1, itemsToUpdate.length, result.mediaItem);
      }

      try {
        await this.applyUpdate(result.mediaItem, result.updateData!);
        success++;
      } catch (error) {
        failed++;
        const errorMsg = `${result.mediaItem.DisplayName}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
      }
    }

    return { success, failed, errors };
  }
}
