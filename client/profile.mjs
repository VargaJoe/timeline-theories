import fs from 'node:fs';
import path from 'node:path';
export function validateProfile(profile, mode) {
  const repo = new URL(profile.repositoryUrl);
  const auth = new URL(profile.authority);
  const loopback = url => ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (![repo,auth].every(url => url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/')) throw new Error('Profiles require HTTPS origin URLs without credentials');
  if (mode === 'm0-local' && (!loopback(repo) || !loopback(auth) || profile.writable !== true)) throw new Error('M0 profile requires loopback repository/auth and local writes');
  if (mode === 'production-readonly' && profile.writable !== false) throw new Error('Remote profile must be read only');
  if (!['auto','SNAuth','IdentityServer'].includes(profile.authType) || !profile.projectRoot?.startsWith('/Root/Content/') || /[\\?#%]/.test(profile.projectRoot) || profile.projectRoot.split('/').some(segment => segment === '.' || segment === '..')) throw new Error('Invalid auth type or project root');
  const allowed = ['repositoryUrl','authority','authType','clientId','projectRoot','writable'];
  if (Object.keys(profile).some(key => !allowed.includes(key))) throw new Error('Profile contains unsupported configuration; only public settings are accepted');
  if (typeof profile.clientId !== 'string') throw new Error('Profile requires a public client ID');
  if (typeof profile.writable !== 'boolean') throw new Error('Writable must be a boolean');
  return {mode,repositoryUrl:repo.origin,authority:auth.origin,authType:profile.authType,
    clientId:profile.clientId,projectRoot:profile.projectRoot,writable:profile.writable};
}
export function readProfile(mode, basePath, env = {}) {
  // Only the explicit M0 command uses the isolated test runtime. Ordinary Vite
  // commands use loadEnv's standard .env / mode / process environment precedence.
  if (mode === 'm0-local') {
    const profile = JSON.parse(fs.readFileSync(path.join(basePath,'profiles','local.json'),'utf8'));
    const override = path.join(basePath,'profiles','local.override.json');
    return validateProfile(fs.existsSync(override) ? {...profile,...JSON.parse(fs.readFileSync(override,'utf8'))} : profile,mode);
  }
  const types = {'auto':'auto','oidc':'IdentityServer','IdentityServer':'IdentityServer','sn-auth':'SNAuth','SNAuth':'SNAuth','jwt':'SNAuth'};
  if (env.VITE_READ_ONLY !== undefined && !['true','false'].includes(env.VITE_READ_ONLY)) throw new Error('VITE_READ_ONLY must be true or false');
  if (!env.VITE_SENSENET_REPO_URL || !env.VITE_OIDC_AUTHORITY) throw new Error('Configure VITE_SENSENET_REPO_URL and VITE_OIDC_AUTHORITY in .env or the build environment');
  return validateProfile({repositoryUrl:env.VITE_SENSENET_REPO_URL,authority:env.VITE_OIDC_AUTHORITY,
    authType:types[env.VITE_AUTH_TYPE || 'auto'],clientId:env.VITE_OIDC_CLIENT_ID || '',
    projectRoot:env.VITE_PROJECT_ROOT_PATH || '/Root/Content/timelines',
    writable:mode !== 'production-readonly' && env.VITE_READ_ONLY !== 'true'},mode);
}

// Expose only settings intended for the browser, never arbitrary VITE_* secrets.
export const publicEnvKeys = ['VITE_SENSENET_REPO_URL','VITE_OIDC_AUTHORITY','VITE_OIDC_CLIENT_ID','VITE_AUTH_TYPE','VITE_PROJECT_ROOT_PATH','VITE_READ_ONLY',
  'VITE_ASSETS_BASE_PATH','VITE_SITE_TITLE','VITE_HEADER_BACKGROUND_IMAGE','VITE_HEADER_OVERLAY_OPACITY',
  'VITE_ENABLE_ABC_PAGINATION','VITE_ENABLE_ALL_TIMELINE_VIEW','VITE_ALL_TIMELINE_PAGE_SIZE','VITE_LOCAL_STORAGE_TTL','VITE_IMAGE_CONCURRENCY_LIMIT',
  'VITE_OMDB_KEY_PATH','VITE_TMDB_KEY_PATH','VITE_TRAKT_KEY_PATH','VITE_USE_TEST_TRAKT_LIST','VITE_MAINTENANCE_MODE'];
export function publicEnvDefines(env) { return Object.fromEntries(publicEnvKeys.map(key => [`import.meta.env.${key}`,JSON.stringify(env[key] ?? '')])); }
