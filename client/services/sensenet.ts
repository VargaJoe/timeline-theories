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
import { Repository } from '@sensenet/client-core';
import { JwtService } from '@sensenet/authentication-jwt';
import { repositoryUrl, authType } from '../configuration';

export const repository = new Repository({ repositoryUrl });

// Set up authentication service based on auth type
if (authType === 'jwt') {
  repository.authentication = new JwtService(repository);
  console.log('[sensenet] Using JWT authentication');
} else {
  console.log('[sensenet] Using OIDC authentication (token set via configuration.token)');
}

/**
 * Sets the access token in the repository configuration
 * This is the proper way to set authentication for sn-client Repository
 */
export const setRepositoryAccessToken = (token: string) => {
  if (!token || token.trim() === '') {
    // Clear the token
    (repository.configuration as { token?: string }).token = undefined;
    console.log('[sensenet] Repository authentication cleared');
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
