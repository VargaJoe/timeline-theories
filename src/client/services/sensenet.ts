import { Repository } from '@sensenet/client-core';
import { repositoryUrl } from '../configuration';

export const repository = new Repository({ repositoryUrl });

export const setRepositoryAccessToken = (token: string) => {
  const origFetch = repository.fetch;
  repository.fetch = (input, init) => {
    const headers = new Headers(init?.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return origFetch.call(repository, input, { ...init, headers });
  };
};
