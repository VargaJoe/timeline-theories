// src/client/services/mediaLibraryService.ts
import { repository } from './sensenet';
import { mediaLibraryPath } from '../projectPaths';
import { MEDIA_ITEM_CONTENT_TYPE } from '../contentTypes';

export interface MediaItem {
  Id: number;
  DisplayName: string;
  Description: string;
  MediaType: string;
  ReleaseDate?: string;
  ChronologicalDate?: string;
  CoverImageUrl?: string;
  Duration?: number;
  Genre?: string;
  Rating?: number;
  ExternalLinks?: string; // JSON string
  Tags?: string;
  CreationDate: string;
  CreatedBy: {
    DisplayName: string;
  };
  SortOrder?: string; // Internal field for metadata storage
}

interface MediaMetadata {
  MediaType?: string;
  ReleaseDate?: string;
  ChronologicalDate?: string;
  CoverImageUrl?: string;
  Duration?: number;
  Genre?: string;
  Rating?: number;
  ExternalLinks?: string;
  Tags?: string;
}

interface SenseNetContent {
  Id: number;
  DisplayName: string;
  Description: string;
  SortOrder?: string;
  CreationDate: string;
  CreatedBy?: {
    DisplayName: string;
  };
  // MediaItem fields (optional for type safety)
  MediaType?: string;
  ReleaseDate?: string;
  ChronologicalDate?: string;
  CoverImageUrl?: string;
  Duration?: number;
  Genre?: string;
  Rating?: number;
  ExternalLinks?: string;
  Tags?: string;
}

export interface CreateMediaItemRequest {
  DisplayName: string;
  Description: string;
  MediaType: string;
  ReleaseDate?: string;
  ChronologicalDate?: string;
  CoverImageUrl?: string;
  Duration?: number;
  Genre?: string;
  Rating?: number;
  ExternalLinks?: string;
  Tags?: string;
}

/**
 * Service for managing media items in the global library
 * Uses SenseNet Memo content type for storage under /Root/Content/MediaLibrary/
 */
export class MediaLibraryService {
  private static readonly MEDIA_LIBRARY_PATH = mediaLibraryPath;

  /**
   * Creates a new media item in the global library
   */
  static async createMediaItem(data: CreateMediaItemRequest): Promise<MediaItem> {
    try {
      console.log('Creating media item with data:', data);

      // Prepare external links as JSON string if provided
      const externalLinksJson = data.ExternalLinks ? 
        (typeof data.ExternalLinks === 'string' ? data.ExternalLinks : JSON.stringify(data.ExternalLinks)) 
        : undefined;


      // Helper to ensure ISO 8601 format for date fields
      function toIsoDateString(date?: string): string | undefined {
        if (!date) return undefined;
        if (date.includes('T')) return date;
        return `${date}T00:00:00Z`;
      }

      // Allowed values for MediaType and Genre
      const allowedMediaTypes = [
        'movie', 'tvepisode', 'tvseries', 'book', 'comic', 'videogame', 'podcast', 'documentary', 'other'
      ];
      const allowedGenres = [
        'action', 'adventure', 'comedy', 'drama', 'fantasy', 'horror', 'mystery', 'romance', 'scifi', 'thriller', 'documentary', 'other'
      ];

      // Map MediaType and Genre to allowed lowercase values
      function mapToAllowedValue(value: string | undefined, allowed: string[]): string | undefined {
        if (!value) return undefined;
        const lower = value.toLowerCase();
        // Accept both display and value forms (e.g. 'SciFi' or 'scifi')
        if (allowed.includes(lower)) return lower;
        // Try to match ignoring case and non-alphanumerics
        const found = allowed.find(opt => opt.toLowerCase() === lower.replace(/[^a-z0-9]/gi, ''));
        return found || undefined;
      }

      const mappedMediaType = mapToAllowedValue(data.MediaType, allowedMediaTypes);
      const mappedGenre = mapToAllowedValue(data.Genre, allowedGenres);

      // Validate rating
      let safeRating: number | undefined = undefined;
      if (typeof data.Rating === 'number' && data.Rating >= 1 && data.Rating <= 10) {
        safeRating = Math.round(data.Rating);
      }

      const releaseDateIso = toIsoDateString(data.ReleaseDate);
      const chronologicalDateIso = toIsoDateString(data.ChronologicalDate);

      const response = await repository.post({
        parentPath: this.MEDIA_LIBRARY_PATH,
        contentType: MEDIA_ITEM_CONTENT_TYPE,
        oDataOptions: {
          select: ['Id', 'DisplayName', 'Description', 'CreationDate', 'CreatedBy/DisplayName'],
          expand: ['CreatedBy']
        },
        content: {
          DisplayName: data.DisplayName,
          Description: data.Description,
          MediaType: mappedMediaType,
          ReleaseDate: releaseDateIso,
          ChronologicalDate: chronologicalDateIso,
          CoverImageUrl: data.CoverImageUrl,
          Duration: data.Duration,
          Genre: mappedGenre,
          Rating: safeRating,
          ExternalLinks: externalLinksJson,
          Tags: data.Tags
        }
      });

      console.log('Media item created successfully:', response);
      return this.mapMemoToMediaItem(response.d);
    } catch (error) {
      console.error('Error creating media item:', error);
      throw new Error('Failed to create media item. Please check your connection and try again.');
    }
  }

  /**
   * Gets all media items from the global library
   */
  static async getMediaItems(): Promise<MediaItem[]> {
    try {
      console.log('Fetching media items from:', this.MEDIA_LIBRARY_PATH);

      const response = await repository.loadCollection({
        path: this.MEDIA_LIBRARY_PATH,
        oDataOptions: {
          query: `TypeIs:${MEDIA_ITEM_CONTENT_TYPE}`,
          select: ['Id', 'DisplayName', 'Description', 'MediaType', 'ReleaseDate', 'ChronologicalDate', 'CoverImageUrl', 'Duration', 'Genre', 'Rating', 'ExternalLinks', 'Tags', 'CreationDate', 'CreatedBy/DisplayName'],
          expand: ['CreatedBy'],
          orderby: ['CreationDate desc']
        }
      });

      console.log('Media items fetched successfully:', response);
      return response.d.results.map((item: SenseNetContent) => this.mapMemoToMediaItem(item));
    } catch (error) {
      console.error('Error fetching media items:', error);
      throw new Error('Failed to load media items. Please check your connection and try again.');
    }
  }

  /**
   * Gets a single media item by ID
   */
  static async getMediaItem(id: number): Promise<MediaItem> {
    try {
      console.log('Fetching media item with ID:', id);

      const response = await repository.load({
        idOrPath: id,
        oDataOptions: {
          select: ['Id', 'DisplayName', 'Description', 'MediaType', 'ReleaseDate', 'ChronologicalDate', 'CoverImageUrl', 'Duration', 'Genre', 'Rating', 'ExternalLinks', 'Tags', 'CreationDate', 'CreatedBy/DisplayName'],
          expand: ['CreatedBy']
        }
      });

      console.log('Media item fetched successfully:', response);
      return this.mapMemoToMediaItem(response.d);
    } catch (error) {
      console.error('Error fetching media item:', error);
      throw new Error('Failed to load media item. Please check your connection and try again.');
    }
  }

  /**
   * Updates an existing media item
   */
  static async updateMediaItem(id: number, data: Partial<CreateMediaItemRequest>): Promise<MediaItem> {
    try {
      console.log('Updating media item:', id, data);

      // Prepare external links if provided
      let externalLinksJson: string | undefined = undefined;
      if (data.ExternalLinks !== undefined) {
        externalLinksJson = typeof data.ExternalLinks === 'string' ? data.ExternalLinks : JSON.stringify(data.ExternalLinks);
      }

      // Date conversion helper
      function toIsoDateString(date?: string): string | undefined {
        if (!date) return undefined;
        const parsed = new Date(date);
        return isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
      }

      // Validate and map data similar to creation
      const allowedMediaTypes = [
        'movie', 'tvepisode', 'tvseries', 'book', 'comic', 'videogame', 'podcast', 'documentary', 'other'
      ];
      const allowedGenres = [
        'action', 'adventure', 'comedy', 'drama', 'fantasy', 'horror', 'mystery', 'romance', 'scifi', 'thriller', 'documentary', 'other'
      ];

      function mapToAllowedValue(value: string | undefined, allowed: string[]): string | undefined {
        if (!value) return undefined;
        const lower = value.toLowerCase();
        if (allowed.includes(lower)) return lower;
        const found = allowed.find(opt => opt.toLowerCase() === lower.replace(/[^a-z0-9]/gi, ''));
        return found || undefined;
      }

      const mappedMediaType = data.MediaType !== undefined ? mapToAllowedValue(data.MediaType, allowedMediaTypes) : undefined;
      const mappedGenre = data.Genre !== undefined ? mapToAllowedValue(data.Genre, allowedGenres) : undefined;

      // Validate rating
      let safeRating: number | undefined = undefined;
      if (data.Rating !== undefined) {
        if (typeof data.Rating === 'number' && data.Rating >= 1 && data.Rating <= 10) {
          safeRating = Math.round(data.Rating);
        }
      }

      // Build update content with only provided fields
      const updateContent: Record<string, string | number | undefined> = {};
      if (data.DisplayName !== undefined) updateContent.DisplayName = data.DisplayName;
      if (data.Description !== undefined) updateContent.Description = data.Description;
      if (mappedMediaType !== undefined) updateContent.MediaType = mappedMediaType;
      if (data.ReleaseDate !== undefined) updateContent.ReleaseDate = toIsoDateString(data.ReleaseDate);
      if (data.ChronologicalDate !== undefined) updateContent.ChronologicalDate = toIsoDateString(data.ChronologicalDate);
      if (data.CoverImageUrl !== undefined) updateContent.CoverImageUrl = data.CoverImageUrl;
      if (data.Duration !== undefined) updateContent.Duration = data.Duration;
      if (mappedGenre !== undefined) updateContent.Genre = mappedGenre;
      if (safeRating !== undefined) updateContent.Rating = safeRating;
      if (externalLinksJson !== undefined) updateContent.ExternalLinks = externalLinksJson;
      if (data.Tags !== undefined) updateContent.Tags = data.Tags;

      console.log('📝 Update content:', updateContent);

      const response = await repository.patch({
        idOrPath: id,
        oDataOptions: {
          select: ['Id', 'DisplayName', 'Description', 'MediaType', 'ReleaseDate', 'ChronologicalDate', 'CoverImageUrl', 'Duration', 'Genre', 'Rating', 'ExternalLinks', 'Tags', 'CreationDate', 'CreatedBy/DisplayName'],
          expand: ['CreatedBy']
        },
        content: updateContent
      });

      console.log('Media item updated successfully:', response);
      return this.mapMemoToMediaItem(response.d);
    } catch (error) {
      console.error('Error updating media item:', error);
      throw new Error('Failed to update media item. Please check your connection and try again.');
    }
  }

  /**
   * Deletes a media item
   */
  static async deleteMediaItem(id: number): Promise<void> {
    try {
      console.log('Deleting media item:', id);

      await repository.delete({
        idOrPath: id,
        permanent: false // Move to Trash instead of permanent deletion
      });

      console.log('Media item deleted successfully');
    } catch (error) {
      console.error('Error deleting media item:', error);
      throw new Error('Failed to delete media item. Please check your connection and try again.');
    }
  }

  /**
   * Searches media items by query
   */
  static async searchMediaItems(query: string, mediaType?: string, genre?: string): Promise<MediaItem[]> {
    try {
      console.log('Searching media items:', { query, mediaType, genre });

      let filter = `TypeIs:'${MEDIA_ITEM_CONTENT_TYPE}'`;
      
      if (query) {
        filter += ` and (substringof('${query}', DisplayName) or substringof('${query}', Description))`;
      }

      const response = await repository.executeAction({
        name: 'GetChildren',
        idOrPath: this.MEDIA_LIBRARY_PATH,
        oDataOptions: {
          select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate', 'CreatedBy/DisplayName'],
          expand: ['CreatedBy'],
          filter,
          orderby: [['CreationDate', 'desc']]
        }
      });

      let results = response.d.results.map((item: SenseNetContent) => this.mapMemoToMediaItem(item));

      // Client-side filtering for metadata stored in SortOrder
      if (mediaType || genre) {
        results = results.filter((item: MediaItem) => {
          const metadata = this.parseMediaMetadata(item.SortOrder || '{}');
          if (mediaType && metadata.MediaType !== mediaType) return false;
          if (genre && metadata.Genre !== genre) return false;
          return true;
        });
      }

      console.log('Media items search completed:', results);
      return results;
    } catch (error) {
      console.error('Error searching media items:', error);
      throw new Error('Failed to search media items. Please check your connection and try again.');
    }
  }

  /**
   * Maps SenseNet Memo content to MediaItem interface
   */
  private static mapMemoToMediaItem(memo: SenseNetContent): MediaItem {
    return {
      Id: memo.Id,
      DisplayName: memo.DisplayName,
      Description: memo.Description,
      MediaType: memo.MediaType || 'Other',
      ReleaseDate: memo.ReleaseDate,
      ChronologicalDate: memo.ChronologicalDate,
      CoverImageUrl: memo.CoverImageUrl,
      Duration: memo.Duration,
      Genre: memo.Genre,
      Rating: memo.Rating,
      ExternalLinks: memo.ExternalLinks,
      Tags: memo.Tags,
      CreationDate: memo.CreationDate,
      CreatedBy: memo.CreatedBy || { DisplayName: 'Unknown' },
      SortOrder: memo.SortOrder // Keep original for updates
    };
  }

  /**
   * Parses media metadata from SortOrder JSON string
   */
  private static parseMediaMetadata(sortOrder: string): MediaMetadata {
    try {
      return JSON.parse(sortOrder) as MediaMetadata;
    } catch {
      return {};
    }
  }
}

export default MediaLibraryService;
