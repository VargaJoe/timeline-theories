// src/client/services/mediaLibraryService.ts
import { repository } from './sensenet';

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
  private static readonly MEDIA_LIBRARY_PATH = '/Root/Content/MediaLibrary';

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

      const response = await repository.post({
        parentPath: this.MEDIA_LIBRARY_PATH,
        contentType: 'Memo',
        oDataOptions: {
          select: ['Id', 'DisplayName', 'Description', 'CreationDate', 'CreatedBy/DisplayName'],
          expand: ['CreatedBy']
        },
        content: {
          DisplayName: data.DisplayName,
          Description: data.Description,
          // Store media-specific data in Description field as structured text
          // Until we can create custom MediaItem content type
          SortOrder: JSON.stringify({
            MediaType: data.MediaType,
            ReleaseDate: data.ReleaseDate,
            ChronologicalDate: data.ChronologicalDate,
            CoverImageUrl: data.CoverImageUrl,
            Duration: data.Duration,
            Genre: data.Genre,
            Rating: data.Rating,
            ExternalLinks: externalLinksJson,
            Tags: data.Tags
          })
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

      const response = await repository.executeAction({
        name: 'GetChildren',
        idOrPath: this.MEDIA_LIBRARY_PATH,
        oDataOptions: {
          select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate', 'CreatedBy/DisplayName'],
          expand: ['CreatedBy'],
          filter: "TypeIs:'Memo'",
          orderby: [['CreationDate', 'desc']]
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
          select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate', 'CreatedBy/DisplayName'],
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

      // Get current item to preserve existing data
      const currentItem = await this.getMediaItem(id);
      const currentMetadata = this.parseMediaMetadata(currentItem.SortOrder || '{}');

      // Merge new data with existing data
      const updatedMetadata = {
        ...currentMetadata,
        MediaType: data.MediaType || currentMetadata.MediaType,
        ReleaseDate: data.ReleaseDate || currentMetadata.ReleaseDate,
        ChronologicalDate: data.ChronologicalDate || currentMetadata.ChronologicalDate,
        CoverImageUrl: data.CoverImageUrl || currentMetadata.CoverImageUrl,
        Duration: data.Duration || currentMetadata.Duration,
        Genre: data.Genre || currentMetadata.Genre,
        Rating: data.Rating || currentMetadata.Rating,
        ExternalLinks: data.ExternalLinks || currentMetadata.ExternalLinks,
        Tags: data.Tags || currentMetadata.Tags
      };

      const response = await repository.patch({
        idOrPath: id,
        oDataOptions: {
          select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate', 'CreatedBy/DisplayName'],
          expand: ['CreatedBy']
        },
        content: {
          DisplayName: data.DisplayName || currentItem.DisplayName,
          Description: data.Description || currentItem.Description,
          SortOrder: JSON.stringify(updatedMetadata)
        }
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

      let filter = "TypeIs:'Memo'";
      
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
    const metadata = this.parseMediaMetadata(memo.SortOrder || '{}');
    
    return {
      Id: memo.Id,
      DisplayName: memo.DisplayName,
      Description: memo.Description,
      MediaType: metadata.MediaType || 'Other',
      ReleaseDate: metadata.ReleaseDate,
      ChronologicalDate: metadata.ChronologicalDate,
      CoverImageUrl: metadata.CoverImageUrl,
      Duration: metadata.Duration,
      Genre: metadata.Genre,
      Rating: metadata.Rating,
      ExternalLinks: metadata.ExternalLinks,
      Tags: metadata.Tags,
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
