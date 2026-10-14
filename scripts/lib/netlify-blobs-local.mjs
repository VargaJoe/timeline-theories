import { BlobsServer } from '../../client/node_modules/@netlify/blobs/dist/server.js';
import { randomUUID } from 'node:crypto';

/** Local compatibility corrections for @netlify/blobs/server 11.1.4 ONLY.
 * The original HTTP server and filesystem remain the source of all data.
 * Its GET handler omits ETags, API listing queries enter the store-name regex,
 * lists are rooted one level too high, and conditional PUT checks precede
 * separate filesystem awaits. This local wrapper restores those semantics.
 * It proves local client/recovery behavior, never Netlify cloud atomicity.
 * Production API modules must never import this local launcher helper. */
class LocalCasBlobsServer extends BlobsServer {
  constructor(options) { super(options); this.mutations = Promise.resolve(); }
  parseAPIRequest(req) {
    const url = new URL(req.url), query = [...url.searchParams]; url.search = '';
    const result = super.parseAPIRequest({ url: url.toString(), headers: req.headers });
    if (result) for (const [key, value] of query) if (key !== 'signature') result.url.searchParams.set(key, value);
    return result;
  }
  getLocalPaths(url) {
    const result = super.getLocalPaths(url);
    if (result.dataPath && !result.key) result.rootPath = result.dataPath;
    return result;
  }
  async get(req) {
    const response = await super.get(req), apiMatch = this.parseAPIRequest(req);
    if (response.status === 200 && !(apiMatch?.key && apiMatch.useSignedURL)) {
      const { key, dataPath } = this.getLocalPaths(apiMatch?.url ?? new URL(req.url));
      if (key && dataPath) response.headers.set('etag', await BlobsServer.generateETag(dataPath));
    }
    return response;
  }
  enqueue(action) {
    const result = this.mutations.then(async () => {
      // SDK file ETags use ISO millisecond mtimes. Preserve change visibility.
      await new Promise(resolve => setTimeout(resolve, 3));
      return action();
    });
    this.mutations = result.catch(() => {}); return result;
  }
  put(req) { return this.enqueue(() => super.put(req)); }
  delete(req) { return this.enqueue(() => super.delete(req)); }
}

export async function startLocalBlobs({ directory, port = 0, siteID = randomUUID(), token = 'local-blobs-' + randomUUID() }) {
  const server = new LocalCasBlobsServer({ directory, port, token, logger: () => {} });
  const { address: url } = await server.start();
  return { url, siteID, token, blobOptions: { apiURL: url, siteID, token }, close: () => server.stop() };
}
