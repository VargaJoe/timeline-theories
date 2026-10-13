import fs from 'node:fs';
import path from 'node:path';
export function validateProfile(profile, mode) {
  const repo = new URL(profile.repositoryUrl);
  const auth = new URL(profile.authority);
  const loopback = url => ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (![repo,auth].every(url => url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/')) throw new Error('Profiles require HTTPS origin URLs without credentials');
  if (!['local','production-readonly'].includes(mode)) throw new Error('Choose --mode local or --mode production-readonly');
  if (mode === 'local' && (!loopback(repo) || !loopback(auth) || profile.writable !== true)) throw new Error('Local profile requires loopback repository/auth and local writes');
  if (mode === 'production-readonly' && profile.writable !== false) throw new Error('Remote profile must be read only');
  if (!['SNAuth','IdentityServer'].includes(profile.authType) || !profile.projectRoot?.startsWith('/Root/Content/') || /[\\?#%]/.test(profile.projectRoot) || profile.projectRoot.split('/').some(segment => segment === '.' || segment === '..')) throw new Error('Invalid auth type or project root');
  const allowed = ['repositoryUrl','authority','authType','clientId','projectRoot','writable'];
  if (Object.keys(profile).some(key => !allowed.includes(key))) throw new Error('Profile contains unsupported configuration; only public settings are accepted');
  if (typeof profile.clientId !== 'string') throw new Error('Profile requires a public client ID');
  return {mode,repositoryUrl:repo.origin,authority:auth.origin,authType:profile.authType,
    clientId:profile.clientId,projectRoot:profile.projectRoot,writable:profile.writable};
}
export function readProfile(mode, basePath) {
  if (mode === 'development-local') mode = 'local';
  const file = path.join(basePath,'profiles',`${mode}.json`);
  const profile = JSON.parse(fs.readFileSync(file,'utf8'));
  const override = path.join(basePath,'profiles',`${mode}.override.json`);
  const merged = fs.existsSync(override) ? {...profile,...JSON.parse(fs.readFileSync(override,'utf8'))} : profile;
  if (process.env.TIMELINE_REPOSITORY_URL) merged.repositoryUrl=process.env.TIMELINE_REPOSITORY_URL;
  if (process.env.TIMELINE_AUTHORITY) merged.authority=process.env.TIMELINE_AUTHORITY;
  return validateProfile(merged,mode);
}
