import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainError, projectPaths } from '../client/domain/content.mjs';
import { configuredKeyPaths } from './provider-secrets.mjs';
import { loadEnv } from '../client/node_modules/vite/dist/node/index.js';
export const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function origin(value, label) {
  let url; try { url = new URL(value); } catch { throw new DomainError('invalid_configuration', `${label} needs an HTTPS origin.`, 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.hash || url.search) throw new DomainError('invalid_configuration', `${label} needs an HTTPS origin.`, 503);
  return url.origin;
}
export function loadConfig({ local = false } = {}) {
  if (process.env.TIMELINE_READ_ONLY !== undefined && !['true','false'].includes(process.env.TIMELINE_READ_ONLY)) throw new DomainError('invalid_configuration','TIMELINE_READ_ONLY must be true or false.',503);
  let profile;
  const publicEnv=local?process.env:{...loadEnv(process.env.TIMELINE_MODE||'development',path.join(WORKSPACE,'client'),'VITE_'),...process.env};
  if (local) {
    profile = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'client/profiles/local.json'), 'utf8'));
    const override = path.join(WORKSPACE, 'client/profiles/local.override.json');
    if (fs.existsSync(override)) profile = { ...profile, ...JSON.parse(fs.readFileSync(override,'utf8')) };
  }
  const config = {
    repositoryUrl: origin(profile?.repositoryUrl || process.env.TIMELINE_REPOSITORY_URL || publicEnv.VITE_SENSENET_REPO_URL, 'Repository'),
    authority: origin(profile?.authority || process.env.TIMELINE_AUTHORITY || publicEnv.VITE_OIDC_AUTHORITY, 'Authority'),
    projectRoot: profile?.projectRoot || process.env.TIMELINE_PROJECT_ROOT || publicEnv.VITE_PROJECT_ROOT_PATH,
    frontendOrigin: origin(local ? 'https://localhost:8080' : process.env.TIMELINE_FRONTEND_ORIGIN, 'Frontend'),
    readOnly: process.env.TIMELINE_READ_ONLY === 'true',
    host: local ? '127.0.0.1' : process.env.TIMELINE_LISTEN_HOST || '127.0.0.1',
    port: local ? 8081 : Number(process.env.TIMELINE_PORT || 8081),
    dataDir: local ? path.join(WORKSPACE, 'deployment/.local/m1-gateway') : process.env.TIMELINE_DATA_DIR,
    ca: local ? fs.readFileSync(path.join(WORKSPACE,'deployment/.local/certificates/localhost.pem')) : process.env.TIMELINE_REPOSITORY_CA ? fs.readFileSync(process.env.TIMELINE_REPOSITORY_CA) : undefined,
    key: fs.readFileSync(local ? path.join(WORKSPACE,'deployment/.local/certificates/localhost.key') : process.env.TIMELINE_TLS_KEY),
    cert: fs.readFileSync(local ? path.join(WORKSPACE,'deployment/.local/certificates/localhost.crt') : process.env.TIMELINE_TLS_CERT),
    local,
    providerKeyPaths:configuredKeyPaths(publicEnv),
  };
  projectPaths(config.projectRoot);
  if (!config.dataDir || !path.isAbsolute(config.dataDir) || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new DomainError('invalid_configuration','Persistent data directory and port are required.',503);
  if (local && (config.repositoryUrl !== 'https://localhost:41016' || config.authority !== 'https://localhost:41017')) throw new DomainError('invalid_configuration','The local gateway requires the isolated M0 target.',503);
  const inventoryFile=process.env.TIMELINE_INVENTORY_FILE || (local ? path.join(WORKSPACE,'deployment/.local/m1-inventory.json') : undefined);
  if(inventoryFile && fs.existsSync(inventoryFile)) {
    const inventory=JSON.parse(fs.readFileSync(inventoryFile,'utf8'));
    if(inventory.repositoryUrl!==config.repositoryUrl||inventory.authority!==config.authority||inventory.projectRoot!==config.projectRoot||inventory.state!=='ready'||!['ApiKey','Bearer'].includes(inventory.credential?.mode)||typeof inventory.credential.value!=='string'||!inventory.credential.value)throw new DomainError('inventory_binding_mismatch','The explicitly configured read-only inventory credential is unavailable or belongs to a different target.',503);
    config.inventoryCredential=inventory.credential;
    config.inventoryIdentity=inventory.identityId;
  } else if(process.env.TIMELINE_INVENTORY_FILE)throw new DomainError('inventory_unavailable','The explicitly configured inventory file is unavailable.',503);
  return config;
}
