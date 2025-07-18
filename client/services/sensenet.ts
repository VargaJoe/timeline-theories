import { Repository } from '@sensenet/client-core';
import { repositoryUrl } from '../configuration';

export const repository = new Repository({ repositoryUrl });

// Store reference to original fetch method for proper cleanup
const originalFetch = repository.fetch.bind(repository);

export const setRepositoryAccessToken = (token: string) => {
  if (!token || token.trim() === '') {
    // Clear authentication by restoring original fetch method
    repository.fetch = originalFetch;
    console.log('[sensenet] Repository authentication cleared');
  } else {
    // Set up authenticated fetch with the provided token
    repository.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      return originalFetch.call(repository, input, { ...init, headers });
    };
    console.log('[sensenet] Repository authentication set with token');
  }
};

export const loadBackgroundImage = async (imagePath: string): Promise<string | null> => {
  try {
    const content = await repository.load({
      idOrPath: imagePath,
      oDataOptions: {
        select: ['Binary']
      }
    });
    
    // Extract the binary streaming URL from SenseNet content
    const binaryUrl = content.d?.Binary?.__mediaresource?.media_src;
    
    if (binaryUrl) {
      // Create full URL if the binary URL is relative
      const fullUrl = binaryUrl.startsWith('http') 
        ? binaryUrl 
        : `${repositoryUrl.replace('/odata.svc', '')}${binaryUrl}`;
      
      console.log('[sensenet] Background image URL:', fullUrl);
      return fullUrl;
    } else {
      console.warn('[sensenet] No binary URL found for image:', imagePath);
      return null;
    }
  } catch (error) {
    console.error('[sensenet] Failed to load background image:', error);
    return null;
  }
};
