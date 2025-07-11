// src/client/scripts/setupMediaLibrary.ts
import { repository } from '../services/sensenet';

/**
 * Creates the MediaLibrary folder in SenseNet if it doesn't exist
 */
export async function setupMediaLibrary(): Promise<void> {
  try {
    console.log('Checking if MediaLibrary folder exists...');
    
    // Check if MediaLibrary folder exists
    try {
      await repository.load({
        idOrPath: '/Root/Content/MediaLibrary'
      });
      console.log('MediaLibrary folder already exists');
      return;
    } catch {
      console.log('MediaLibrary folder not found, creating it...');
    }

    // Create MediaLibrary folder
    const response = await repository.post({
      parentPath: '/Root/Content',
      contentType: 'Folder',
      content: {
        DisplayName: 'MediaLibrary',
        Description: 'Global library for storing media items like movies, TV shows, books, comics, etc.'
      }
    });

    console.log('MediaLibrary folder created successfully:', response);
  } catch (error) {
    console.error('Error setting up MediaLibrary folder:', error);
    throw new Error('Failed to setup MediaLibrary folder');
  }
}

// Auto-setup when this module is imported
setupMediaLibrary().catch(console.error);
