// src/client/scripts/setupMediaLibrary.ts
import { repository } from '../services/sensenet';

/**
 * Creates the MediaLibrary MemoList in SenseNet if it doesn't exist
 * Note: Must use MemoList content type to store Memo items (SenseNet requirement)
 */
export async function setupMediaLibrary(): Promise<void> {
  try {
    console.log('Checking if MediaLibrary MemoList exists...');
    
    // Check if MediaLibrary folder exists
    try {
      await repository.load({
        idOrPath: '/Root/Content/MediaLibrary'
      });
      console.log('MediaLibrary MemoList already exists');
      return;
    } catch {
      console.log('MediaLibrary MemoList not found, creating it...');
    }

    // Create MediaLibrary as MemoList (required for storing Memo items)
    const response = await repository.post({
      parentPath: '/Root/Content',
      contentType: 'MemoList',
      content: {
        DisplayName: 'MediaLibrary',
        Description: 'Global library for storing media items like movies, TV shows, books, comics, etc.'
      }
    });

    console.log('MediaLibrary MemoList created successfully:', response);
  } catch (error) {
    console.error('Error setting up MediaLibrary folder:', error);
    throw new Error('Failed to setup MediaLibrary MemoList');
  }
}

// Auto-setup when this module is imported
setupMediaLibrary().catch(console.error);
