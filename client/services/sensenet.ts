import { Repository } from '@sensenet/client-core';
import { JwtService } from '@sensenet/authentication-jwt';
import { repositoryUrl, authType, sensenetApiKey } from '../configuration';

// Helper to check if user is authenticated (will be set up after repository is created)
let isAuthenticated = () => false;

// Patch global fetch to inject API key as query parameter for SenseNet requests if API key is configured
// Only applies when user is NOT authenticated with a token
if (sensenetApiKey) {
  const originalGlobalFetch = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    
    // Only inject API key for requests to our SenseNet repository AND when user is not authenticated
    if (url.startsWith(repositoryUrl)) {
      // Check authentication status dynamically
      if (!isAuthenticated()) {
        console.log('[sensenet] Global fetch intercepted for SenseNet request, adding apikey as query parameter');
        
        // Add apikey as query parameter instead of header to avoid CORS preflight
        const urlObj = new URL(url);
        urlObj.searchParams.set('apikey', sensenetApiKey);
        url = urlObj.toString();
        
        // Update input to use the new URL
        if (typeof input === 'string') {
          input = url;
        } else if (input instanceof URL) {
          input = new URL(url);
        } else {
          input = new Request(url, input);
        }
      } else {
        console.log('[sensenet] Global fetch intercepted for SenseNet request, user is authenticated - NOT adding apikey');
      }
    }
    
    // Pass through with potentially modified URL
    return originalGlobalFetch(input, init);
  };
  
  console.log('[sensenet] Global fetch patched to inject API key as query parameter for SenseNet requests (when not authenticated)');
}

// Create repository
export const repository = new Repository({ 
  repositoryUrl
});

// Set up the authentication check function
isAuthenticated = () => !!(repository.configuration as { token?: string }).token;

/**
 * Appends apikey to SenseNet URLs if authentication is needed and URL is for SenseNet.
 * This is essential for binary URLs (images, files) that are used directly in <img> tags
 * or downloads, since they bypass the fetch wrapper.
 * 
 * For binary handler URLs, ALWAYS appends apikey (even when authenticated) because:
 * - Browser <img> tags cannot send Bearer tokens (SNAuth mode)
 * - Browser <img> tags may not send cookies properly (some auth modes)
 * For OData API URLs, only appends when not authenticated (to preserve user permissions).
 */
export function appendApiKeyToUrl(url: string): string {
  // If no apikey configured, return URL as-is
  if (!sensenetApiKey) return url;
  
  // Only append apikey to SenseNet URLs
  if (!url.startsWith(repositoryUrl)) return url;
  
  // Check if this is a binary handler URL
  const isBinaryUrl = url.includes('/binaryhandler.ashx');
  
  // For binary URLs, always append apikey (browsers can't send Bearer tokens in img tags)
  // For OData URLs, only append when not authenticated (to preserve user permissions)
  const hasToken = (repository.configuration as { token?: string }).token;
  const shouldAppendApiKey = isBinaryUrl || !hasToken;
  
  if (!shouldAppendApiKey) return url;
  
  try {
    const urlObj = new URL(url);
    // Only add if not already present
    if (!urlObj.searchParams.has('apikey')) {
      urlObj.searchParams.set('apikey', sensenetApiKey);
    }
    return urlObj.toString();
  } catch (error) {
    console.error('[sensenet] Failed to append apikey to URL:', url, error);
    return url;
  }
}

/**
 * Converts a SenseNet binary URL to a blob URL that works with authenticated requests.
 * This is needed for <img> tags when user is authenticated, since img tags can't send JWT tokens.
 */
export async function binaryUrlToBlob(binaryUrl: string): Promise<string | null> {
  try {
    const response = await repository.fetch(binaryUrl);
    if (!response.ok) {
      console.error('[sensenet] Failed to fetch binary:', response.status, response.statusText);
      return null;
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    return objectUrl;
  } catch (error) {
    console.error('[sensenet] Failed to convert binary URL to blob:', error);
    return null;
  }
}

// Set up authentication service based on auth type
if (authType === 'jwt') {
  repository.authentication = new JwtService(repository);
  console.log('[sensenet] Using JWT authentication');
} else if (sensenetApiKey) {
  console.log('[sensenet] Using API key authentication for unauthenticated users');
} else {
  console.log('[sensenet] Using OIDC authentication (token set via configuration.token)');
}

/**
 * Loads an API key from SenseNet ECM by content path.
 * @param serviceKeyPath The full SenseNet path to the ApiKeyStore content (e.g. /Root/Content/(structure)/apikeys/omdb)
 * @returns The API key as string, or null if not found or error.
 */
export async function loadApiKey(serviceKeyPath: string): Promise<string | null> {
  try {
    const content = await repository.load({
      idOrPath: serviceKeyPath,
      oDataOptions: { select: ['ApiKey'] }
    });
    return content.d?.ApiKey || null;
  } catch (error) {
    console.error('[sensenet] Failed to load API key:', error);
    return null;
  }
}

/**
 * Sets the access token in the repository configuration
 * This is the proper way to set authentication for sn-client Repository
 */
/**
 * Sets the access token in the repository configuration
 * This is the proper way to set authentication for sn-client Repository
 */
export const setRepositoryAccessToken = (token: string) => {
  if (!token || token.trim() === '') {
    // Clear the token - API key will continue to work via httpProviderRef
    (repository.configuration as { token?: string }).token = undefined;
    console.log('[sensenet] Repository token cleared (API key remains active if configured)');
  } else {
    // Set the token in repository configuration - this is the proper sn-client way
    (repository.configuration as { token?: string }).token = token;
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
      let fullUrl = binaryUrl.startsWith('http') 
        ? binaryUrl 
        : `${repositoryUrl.replace('/odata.svc', '')}${binaryUrl}`;
      
      // Append apikey for unauthenticated access
      fullUrl = appendApiKeyToUrl(fullUrl);
      
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
