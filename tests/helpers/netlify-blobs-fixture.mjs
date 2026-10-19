import { startLocalBlobs } from '../../scripts/lib/netlify-blobs-local.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

export async function startBlobFixture({ directoryRoot = process.cwd() } = {}) {
  const directory = await mkdtemp(path.join(directoryRoot, '.netlify-state-fixture-'));
  const local = await startLocalBlobs({ directory });
  return { ...local, directory, close: async () => {
    await local.close(); await rm(directory, { recursive: true, force: true });
  } };
}
