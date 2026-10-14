import { createRequire } from 'node:module';
import { Repository } from './repository.mjs';
import { DomainError } from '../client/domain/content.mjs';
const require=createRequire(import.meta.url);
const defaults={omdb:'/(structure)/apikeys/omdb',tmdb:'/(structure)/apikeys/tmdb',trakt:'/(structure)/apikeys/trakt'};
export function configuredKeyPaths(env=process.env) {
  const paths={};
  for(const name of Object.keys(defaults)) {
    const value=env['VITE_'+name.toUpperCase()+'_KEY_PATH'] || defaults[name];
    if(typeof value!=='string'||!value.startsWith('/(structure)/apikeys/')||value.split('/').some(s=>s==='.'||s==='..')||/[\\?#%\x00-\x1f]/.test(value))throw new DomainError('invalid_configuration','Provider key paths must stay inside the configured project key store.',503);
    paths[name]=value;
  }
  return paths;
}
/** Explicit test-only secret reader: three GETs to Joe's configured production
 * key store. This credential is never used for application content operations. */
export async function productionReadOnlyKeySource() {
  const {loadConfiguredMcp,PRODUCTION_URL}=require('../scripts/m0-snapshot.cjs');
  const configured=await loadConfiguredMcp();
  const repositoryUrl=new URL(PRODUCTION_URL).origin;
  return {repositoryUrl,projectRoot:'/Root/Content/timelines',credential:{mode:'ApiKey',value:configured.apiKey},label:'explicit production read-only provider secret source'};
}
export async function resolveProviderKeys(context,config,operation,input,beforeFetch) {
  const keys={omdb:process.env.OMDB_API_KEY,tmdb:process.env.TMDB_API_KEY,trakt:process.env.TRAKT_API_KEY,googlebooks:process.env.GOOGLE_BOOKS_API_KEY};
  if(operation.startsWith('books.'))return keys;
  const names=operation==='trakt.list'?['trakt']:input.preferredSources || ['omdb','tmdb','trakt'];
  if(!Array.isArray(names)||names.some(name=>!Object.hasOwn(defaults,name)))throw new DomainError('invalid_provider_input','Unsupported metadata provider preference.');
  const source=config.providerKeySource;
  const repo=source?new Repository({...config,repositoryUrl:source.repositoryUrl,projectRoot:source.projectRoot,ca:undefined,readOnly:true},source.credential):context.repo;
  const root=source?.projectRoot||config.projectRoot;
  for(const name of names) {
    if(keys[name])continue;
    await beforeFetch();
    const target=root+config.providerKeyPaths[name];
    // Only exact configured key nodes and ApiKey are requested. No external
    // request gets repository credentials; no response contains these values.
    try {
      await repo.assert([{target,action:'read'}]);
      const value=await repo.api(target,null,{query:{'$select':'ApiKey',metadata:'no'}});
      if(typeof value?.ApiKey==='string'&&value.ApiKey.trim()&&value.ApiKey.length<=8192)keys[name]=value.ApiKey.trim();
    } catch(error) {
      if(error.status===404)continue; // Unconfigured provider; never provisions.
      throw new DomainError('provider_secret_denied','The server cannot read the configured provider secret.',error.status===403||error.status===401?403:503);
    }
  }
  return keys;
}
