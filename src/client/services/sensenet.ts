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
