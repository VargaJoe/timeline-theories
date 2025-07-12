// src/client/scripts/setupMediaLibrary.ts
import { repository } from '../services/sensenet';
import { mediaLibraryPath, projectRoot } from '../projectPaths';
import { MEDIA_ITEM_CONTENT_TYPE } from '../contentTypes';

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
        idOrPath: mediaLibraryPath
      });
      console.log('MediaLibrary folder already exists');
      return;
    } catch {
      console.log('MediaLibrary folder not found, creating it...');
    }

    // Create MediaLibrary as a folder (or MemoList if required by SenseNet)
    const response = await repository.post({
      parentPath: projectRoot,
      contentType: 'Folder',
      content: {
        DisplayName: 'MediaLibrary',
        Description: 'Global library for storing media items like movies, TV shows, books, comics, etc.'
      }
    });

    console.log('MediaLibrary folder created successfully:', response);
  } catch (error) {
    console.error('Error setting up MediaLibrary folder:', error);
    throw new Error('Failed to setup MediaLibrary MemoList');
  }
}

// Auto-setup when this module is imported
setupMediaLibrary().catch(console.error);
