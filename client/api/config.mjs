import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainError, projectPaths } from '../domain/content.mjs';
import { configuredKeyPaths } from './provider-secrets.mjs';
export const WORKSPACE = process.env.TIMELINE_LOCAL_PROFILE === 'true' && process.env.TIMELINE_LOCAL_WORKSPACE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function origin(value, label) {
  let url; try { url = new URL(value); } catch { throw new DomainError('invalid_configuration', `${label} needs an HTTPS origin.`, 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.hash || url.search) throw new DomainError('invalid_configuration', `${label} needs an HTTPS origin.`, 503);
  return url.origin;
}
export function loadConfig({ local = process.env.TIMELINE_LOCAL_PROFILE === 'true', runtimeContext, requestUrl } = {}) {
  const devRuntime = process.env.TIMELINE_NETLIFY_DEV === 'true';
  let appCa;
  if (devRuntime) {
    const file = process.env.TIMELINE_APP_DEV_CA_FILE;
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new DomainError('invalid_configuration','App development requires an absolute localhost CA file.',503);
    try { appCa = fs.readFileSync(file); } catch { throw new DomainError('invalid_configuration','The localhost app CA file is unavailable.',503); }
  }
  if (process.env.TIMELINE_READ_ONLY !== undefined && !['true','false'].includes(process.env.TIMELINE_READ_ONLY)) throw new DomainError('invalid_configuration','TIMELINE_READ_ONLY must be true or false.',503);
  if (process.env.VITE_READ_ONLY !== undefined && !['true','false'].includes(process.env.VITE_READ_ONLY)) throw new DomainError('invalid_configuration','VITE_READ_ONLY must be true or false.',503);
  let profile;
  if (local) {
    profile = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'client/profiles/local.json'), 'utf8'));
    const override = path.join(WORKSPACE, 'client/profiles/local.override.json');
    if (fs.existsSync(override)) profile = { ...profile, ...JSON.parse(fs.readFileSync(override,'utf8')) };
  }
  const deployContext=runtimeContext?.deploy?.context || process.env.CONTEXT;
  let appOrigin=process.env.TIMELINE_FRONTEND_ORIGIN || process.env.DEPLOY_PRIME_URL || runtimeContext?.site?.url || process.env.URL;
  if (!local && !devRuntime && deployContext==='deploy-preview' && runtimeContext?.site?.name && requestUrl) {
    const request=new URL(requestUrl), name=runtimeContext.site.name;
    if (/^[a-z0-9-]+$/.test(name) && request.protocol==='https:' && new RegExp('^deploy-preview-[1-9][0-9]*--'+name+'\\.netlify\\.app$').test(request.hostname)) appOrigin=request.origin;
  }
  const config = {
    repositoryUrl: origin(profile?.repositoryUrl || process.env.TIMELINE_REPOSITORY_URL || process.env.VITE_SENSENET_REPO_URL, 'Repository'),
    authority: origin(profile?.authority || process.env.TIMELINE_AUTHORITY || process.env.VITE_OIDC_AUTHORITY, 'Authority'),
    projectRoot: profile?.projectRoot || process.env.TIMELINE_PROJECT_ROOT || process.env.VITE_PROJECT_ROOT_PATH,
    frontendOrigin: origin(local || devRuntime ? 'https://localhost:8080' : appOrigin, 'App'),
    readOnly: process.env.TIMELINE_READ_ONLY === 'true' || process.env.VITE_READ_ONLY === 'true',
    ca: local ? fs.readFileSync(path.join(WORKSPACE,'deployment/.local/certificates/localhost.pem')) : undefined,
    local,
    devRuntime,
    appCa,
    providerKeyPaths: configuredKeyPaths(),
    deployContext,
    deployId: runtimeContext?.deploy?.id || (local ? 'local-sdk-verification' : devRuntime ? 'local-app-development' : undefined),
    blobStoreName: deployContext === 'deploy-preview' ? 'timeline-preview-' + (runtimeContext?.deploy?.id || process.env.REVIEW_ID || 'unknown') : 'timeline-app-state-v1',
  };
  projectPaths(config.projectRoot);
  if (local && (config.repositoryUrl !== 'https://localhost:41016' || config.authority !== 'https://localhost:41017')) throw new DomainError('invalid_configuration','The explicit local profile requires the isolated M0 target.',503);
  if ((local || devRuntime) && process.env.TIMELINE_LOCAL_BLOB_ENDPOINT) {
    const url = new URL(process.env.TIMELINE_LOCAL_BLOB_ENDPOINT);
    if (url.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !process.env.TIMELINE_LOCAL_BLOB_SITE_ID || !process.env.TIMELINE_LOCAL_BLOB_TOKEN) throw new DomainError('invalid_configuration','Local app storage requires the trusted loopback emulator.',503);
    config.blobOptions = { apiURL: url.origin, siteID: process.env.TIMELINE_LOCAL_BLOB_SITE_ID, token: process.env.TIMELINE_LOCAL_BLOB_TOKEN };
  }
  const inventoryFile = local ? path.join(WORKSPACE,'deployment/.local/m1-inventory.json') : undefined;
  const inventory = process.env.TIMELINE_INVENTORY_CREDENTIAL ? JSON.parse(process.env.TIMELINE_INVENTORY_CREDENTIAL) : inventoryFile && fs.existsSync(inventoryFile) ? JSON.parse(fs.readFileSync(inventoryFile,'utf8')) : null;
  if (inventory) {
    if (inventory.repositoryUrl !== config.repositoryUrl || inventory.authority !== config.authority || inventory.projectRoot !== config.projectRoot || inventory.state !== 'ready' || !Number.isSafeInteger(inventory.identityId) || inventory.identityId < 1 || !['ApiKey','Bearer'].includes(inventory.credential?.mode) || typeof inventory.credential.value !== 'string' || !inventory.credential.value) throw new DomainError('inventory_binding_mismatch','The explicit read-only inventory credential belongs to a different target or is unavailable.',503);
    config.inventoryCredential = inventory.credential; config.inventoryIdentity = inventory.identityId;
  }
  return config;
}
