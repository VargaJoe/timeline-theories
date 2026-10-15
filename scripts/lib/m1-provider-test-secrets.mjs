import { createRequire } from 'node:module';
import { Repository } from '../../client/api/repository.mjs';
import { configuredKeyPaths } from '../../client/api/provider-secrets.mjs';

const require = createRequire(import.meta.url);
const names = { omdb: 'OMDB_API_KEY', tmdb: 'TMDB_API_KEY', trakt: 'TRAKT_API_KEY' };

/** Explicit local-provider test setup only. It reads the three exact configured
 * production key nodes using GET and exports only provider values to the local
 * Function process. The configured production repository credential never
 * enters that process, app storage, a provider request, or a log. Production
 * Function code must never import this local Codex configuration reader. */
export async function loadProductionProviderTestKeys({ environment = process.env } = {}) {
  const { loadConfiguredMcp, PRODUCTION_URL } = require('../m0-snapshot.cjs');
  const configured = await loadConfiguredMcp(), repositoryUrl = new URL(PRODUCTION_URL).origin;
  const projectRoot = '/Root/Content/timelines', paths = configuredKeyPaths(environment);
  const repo = new Repository({ repositoryUrl, projectRoot, readOnly: true }, { mode: 'ApiKey', value: configured.apiKey });
  const keys = {};
  for (const [name, variable] of Object.entries(names)) {
    try {
      const value = await repo.api(projectRoot + paths[name], null, { method: 'GET', maxBytes: 64 * 1024, query: { '$select': 'ApiKey', metadata: 'no' } });
      if (typeof value?.ApiKey !== 'string' || !value.ApiKey.trim() || value.ApiKey.length > 8192) throw new Error('Provider key response is invalid.');
      keys[variable] = value.ApiKey.trim();
    } catch (error) {
      if (error.status === 404) continue;
      throw new Error('The explicit production provider test key GET was denied or failed.');
    }
  }
  return keys;
}
