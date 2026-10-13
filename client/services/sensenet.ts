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
import { repositoryUrl, environment } from '../configuration';
import { createOperationGuard, guardRepository, snapshotRequestInit } from './operationGuard.mjs';
export type { Operation } from './operationGuard.mjs';

const rawRepository = new Repository({ repositoryUrl });
const originalFetch = rawRepository.fetch.bind(rawRepository);
const copyFormData = (body: FormData) => {
  const copy = new FormData();
  body.forEach((value, key) => copy.append(key, value));
  return copy;
};
const isConfiguredWriteTarget = () => environment.writable &&
  rawRepository.configuration.repositoryUrl.replace(/\/$/, '') === repositoryUrl;
rawRepository.fetch = async (input: RequestInfo, init?: RequestInit, awaitReadyState?: boolean) => {
  if (typeof input !== 'string') throw new Error('Request objects are not supported by the checked repository');
  const url = new URL(input, repositoryUrl);
  if (url.origin !== repositoryUrl) throw new Error('Cross-repository requests are disabled');
  const checkedUpload = init?.body instanceof FormData ? checkedUploads.get(init.body) : undefined;
  const requestInit = snapshotRequestInit(init);
  const body = requestInit.body;
  const method = requestInit.method;
  const checkContext = permissionGuard.context();
  const before = rawRepository.configuration.token;
  if (awaitReadyState !== false) await rawRepository.awaitReadyState();
  if (before !== rawRepository.configuration.token) throw new Error('Identity changed before dispatch');
  if (!['GET', 'HEAD'].includes(method)) {
    if (!isConfiguredWriteTarget()) throw new Error('Repository writes are disabled by configuration');
    const item = url.pathname.replace(/^\/odata\.svc\//i, '').replace(/\/[^/]+$/, matched => /\/DeleteBatch|\/upload/i.test(matched) ? '' : matched);
    const idMatch = item.match(/^content\((\d+)\)$/i);
    const target = idMatch ? Number(idMatch[1]) : decodeURIComponent(item.replace(/\('([^']*(?:''[^']*)*)'\)$/, '/$1').replace(/''/g, "'")).replace(/^([^/])/, '/$1');
    if (body instanceof FormData) {
      // Only uploadBinary may submit multipart. Its target is separately checked there.
      const checked = checkedUpload;
      if (!checked) throw new Error('Unchecked upload');
      await assertOperations([{ target: checked, action: 'upload' }]);
    } else {
      const payload = typeof body === 'string' ? JSON.parse(body) : {};
      if (/\/DeleteBatch$/i.test(url.pathname)) await assertOperations((payload.paths || []).map((value: string | number) => ({target:value,action:'delete' as const})));
      else if (method === 'PATCH') await assertOperations([{target,action:'update'}]);
      else if (method === 'POST' && typeof payload.__ContentType === 'string') await assertOperations([{target,action:'create',contentType:payload.__ContentType}]);
      else throw new Error('Unsupported mutation endpoint');
    }
    if (before !== rawRepository.configuration.token || !isConfiguredWriteTarget()) throw new Error('Identity/repository changed before dispatch');
    checkContext();
    return originalFetch(input, requestInit, false);
  }
  checkContext();
  return originalFetch(input, requestInit, false);
};
const checkedUploads = new WeakMap<FormData, string | number>();
const permissionGuard = createOperationGuard({
  probe: async (target, permissions) => {
    // SenseNet's HasPermission action excludes Visitor, even for public content.
    // Anonymous read availability is proved by the actual backend GET on this
    // exact content; denied/missing/transport failures still fail closed.
    if (!rawRepository.configuration.token && permissions.length === 1 && permissions[0] === 'Open') {
      const result = await rawRepository.load({ idOrPath: target, oDataOptions: { select: ['Id'], metadata: 'no' } });
      return Number.isSafeInteger(result.d?.Id) && result.d.Id > 0;
    }
    return rawRepository.security.hasPermission(target, permissions);
  },
  childTypes: async target => {
    const result = await rawRepository.allowedChildTypes.get({ idOrPath: target });
    return result.d.results.map((type: { Name: string }) => type.Name);
  },
  writable: isConfiguredWriteTarget,
  identity: () => `${rawRepository.configuration.repositoryUrl}:${rawRepository.configuration.token || ''}`,
});
export const repository = guardRepository(rawRepository, permissionGuard);
export const assertOperations = permissionGuard.assert;
export const canOperations = permissionGuard.can;
export const invalidatePermissions = permissionGuard.invalidate;
export const subscribePermissions = permissionGuard.subscribe;
export const captureOperationContext = permissionGuard.context;

export async function uploadBinary(target: string | number, url: string, body: FormData): Promise<Response> {
  const checkContext = captureOperationContext();
  body = copyFormData(body);
  await assertOperations([{ target, action: 'upload' }]);
  const content = await repository.load({ idOrPath: target, oDataOptions: { select: ['Id', 'Name', 'ParentId', 'Type'] } });
  const expected = `${repositoryUrl}/odata.svc/content(${content.d.ParentId})/upload`;
  if (url !== expected || body.get('FileName') !== content.d.Name || body.get('PropertyName') !== 'CoverImageBin' || body.get('Overwrite') !== 'true') throw new Error('Upload target does not match checked content');
  const fields = new Set(['ChunkToken','FileName','Overwrite','PropertyName','FileLength','ContentType','ContentId',content.d.Name]);
  body.forEach((_value,key) => { if (!fields.has(key) || body.getAll(key).length !== 1) throw new Error('Unsupported or duplicate upload field'); });
  const file = body.get(content.d.Name);
  if (!(file instanceof Blob) || body.get('FileLength') !== String(file.size) || body.get('ContentType') !== content.d.Type || body.get('ChunkToken') !== '0*0*False*False' || (body.has('ContentId') && body.get('ContentId') !== String(content.d.Id))) throw new Error('Upload metadata does not match checked content');
  // A fresh check follows all asynchronous preparation; the backend remains authoritative.
  await assertOperations([{ target, action: 'upload' }]);
  checkContext();
  checkedUploads.set(body, target);
  return rawRepository.fetch(url, { method: 'POST', body });
}

// Set up authentication service based on auth type

/**
 * Sets the access token in the repository configuration
 * This is the proper way to set authentication for sn-client Repository
 */
export const setRepositoryAccessToken = (token: string) => {
  if (rawRepository.configuration.token === (token || undefined)) return;
  invalidatePermissions();
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
