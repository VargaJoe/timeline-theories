// Utility: Resize image to default dimensions and return Blob
import { siteConfig } from '../configuration';

export async function resizeImageToDefault(url: string): Promise<Blob> {
  const img = document.createElement('img');
  img.crossOrigin = 'anonymous';
  img.src = url;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
  const canvas = document.createElement('canvas');
  canvas.width = siteConfig.coverImageDefaultWidth;
  canvas.height = siteConfig.coverImageDefaultHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to convert image to blob'));
    }, 'image/jpeg', 0.92);
  });
}

// Upload cover image as binary to SenseNet
/**
 * Upload cover image as binary to SenseNet
 * @param mediaItemRef - number (content ID) or string (full path)
 * @param imageBlob - image data
 * @param fileName - optional file name
 */
export async function uploadCoverImageBinary(
  mediaItemRef: number | string,
  imageBlob: Blob,
  fileName: string = 'cover.jpg'
): Promise<void> {
  console.log('[uploadCoverImageBinary] called with:', { mediaItemRef, imageBlob, fileName });
  
  try {
    // Get the media item's Name and parent ID
    const content = await repository.load({
      idOrPath: mediaItemRef,
      oDataOptions: {
        select: ['Id', 'ParentId', 'Name']
      }
    });
    
    if (!content?.d?.Id || !content?.d?.Name || !content?.d?.ParentId) {
      throw new Error(`Cannot find content or missing ParentId: ${mediaItemRef}`);
    }
    
    const mediaItemName = content.d.Name;
    const parentId = content.d.ParentId;
    console.log('[uploadCoverImageBinary] resolved:', { mediaItemName, parentId, mediaItemRef });

    // Create FormData for multipart upload
    const formData = new FormData();
    formData.append('ChunkToken', '0*0*False*False');
    formData.append('FileName', mediaItemName); // Use media item's Name as filename
    formData.append('Overwrite', 'true');
    formData.append('PropertyName', 'CoverImageBin'); // Target the binary field
    formData.append('FileLength', imageBlob.size.toString());
    formData.append('ContentType', 'MediaItem'); // Specify content type
    formData.append(mediaItemName, imageBlob, fileName); // Use media item Name as form field name

    // Upload to parent container using SenseNet upload endpoint with parent ID
    const uploadUrl = `${repositoryUrl}/odata.svc/content(${parentId})/upload`;
    console.log('[uploadCoverImageBinary] uploading to:', uploadUrl);
    
    const uploadResult = await repository.fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });

    if (!uploadResult.ok) {
      const errorText = await uploadResult.text();
      console.error('[uploadCoverImageBinary] uploadResult error:', errorText);
      throw new Error(`Failed to upload cover image binary: ${uploadResult.status} ${uploadResult.statusText}`);
    }

    const result = await uploadResult.json();
    console.log('[uploadCoverImageBinary] upload successful:', result);
  } catch (err) {
    console.error('[uploadCoverImageBinary] exception:', err);
    throw new Error('Failed to upload cover image binary');
  }
}

// src/client/services/mediaLibraryService.ts
import { repository } from './sensenet';
import { mediaLibraryPath } from '../projectPaths';
import { MEDIA_ITEM_CONTENT_TYPE } from '../contentTypes';
import { repositoryUrl } from '../configuration';

export interface MediaItem {
  Id: number;
  ParentId?: number; 
  Name: string;
  DisplayName: string;
  Description: string;
  MediaType: string;
  ReleaseDate?: string;
  ChronologicalDate?: string;
  CoverImageUrl?: string;
  CoverImageBin?: {
    __mediaresource: {
      media_src: string;
      content_type: string;
    };
  };
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
  Name: string;
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
  CoverImageBin?: {
    __mediaresource: {
      media_src: string;
      content_type: string;
    };
  };
  Duration?: number;
  Genre?: string;
  Rating?: number;
  ExternalLinks?: string;
  Tags?: string;
}

export interface CreateMediaItemRequest {
  DisplayName: string;
  Title?: string;
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
          select: ['Id', 'ParentId', 'DisplayName', 'Title', 'Description', 'CreationDate', 'CreatedBy/DisplayName'],
          expand: ['CreatedBy']
        },
        content: {
          DisplayName: data.DisplayName,
          Title: data.Title,
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
          query: `+TypeIs:${MEDIA_ITEM_CONTENT_TYPE} +Hidden:0`,
          select: ['Id', 'ParentId', 'DisplayName', 'Description', 'MediaType', 'ReleaseDate', 'ChronologicalDate', 'CoverImageUrl', 'CoverImageBin', 'Duration', 'Genre', 'Rating', 'ExternalLinks', 'Tags', 'CreationDate', 'CreatedBy/DisplayName'],
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
          select: ['Id', 'ParentId', 'DisplayName', 'Description', 'MediaType', 'ReleaseDate', 'ChronologicalDate', 'CoverImageUrl', 'CoverImageBin', 'Duration', 'Genre', 'Rating', 'ExternalLinks', 'Tags', 'CreationDate', 'CreatedBy/DisplayName'],
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
   * Gets a single media item by its SEO-friendly Name
   */
  static async getMediaItemByName(name: string): Promise<MediaItem> {
    try {
      // Use a query to find by Name, supporting subfolders
      const query = `+Name:'${name}' +TypeIs:'${MEDIA_ITEM_CONTENT_TYPE}'`;
      const response = await repository.loadCollection({
        path: mediaLibraryPath,
        oDataOptions: {
          query,
          select: ['Id', 'ParentId', 'Name', 'DisplayName', 'Description', 'MediaType', 'ReleaseDate', 'ChronologicalDate', 'CoverImageUrl', 'CoverImageBin', 'Duration', 'Genre', 'Rating', 'ExternalLinks', 'Tags', 'CreationDate', 'CreatedBy/DisplayName'],
          expand: ['CreatedBy']
        }
      });
      if (response.d.results.length === 0) {
        throw new Error('Media item not found by Name.');
      }
      return this.mapMemoToMediaItem(response.d.results[0]);
    } catch (error) {
      console.error('Error fetching media item by Name:', error);
      throw new Error('Failed to load media item by Name. Please check your connection and try again.');
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
          select: ['Id', 'ParentId', 'DisplayName', 'Description', 'MediaType', 'ReleaseDate', 'ChronologicalDate', 'CoverImageUrl', 'CoverImageBin', 'Duration', 'Genre', 'Rating', 'ExternalLinks', 'Tags', 'CreationDate', 'CreatedBy/DisplayName'],
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
          select: ['Id', 'ParentId', 'DisplayName', 'Description', 'SortOrder', 'CreationDate', 'CreatedBy/DisplayName'],
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
      Name: memo.Name,
      DisplayName: memo.DisplayName,
      Description: memo.Description,
      MediaType: memo.MediaType || 'Other',
      ReleaseDate: memo.ReleaseDate,
      ChronologicalDate: memo.ChronologicalDate,
      CoverImageUrl: memo.CoverImageUrl,
      CoverImageBin: memo.CoverImageBin,
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
   * Helper function to get cover image URL (either from URL field or binary field)
   */
  static getCoverImageUrl(mediaItem: MediaItem): string | null {
    // If URL is set, use it
    if (mediaItem.CoverImageUrl) {
      return mediaItem.CoverImageUrl;
    }
    
    // Otherwise, check if we have a binary image
    if (mediaItem.CoverImageBin && mediaItem.CoverImageBin.__mediaresource) {
      const relativePath = mediaItem.CoverImageBin.__mediaresource.media_src;
      return `${repositoryUrl}${relativePath}`;
    }
    
    return null;
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
