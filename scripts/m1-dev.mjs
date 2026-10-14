import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The only public app origin is Netlify Dev. Vite is its internal UI server;
 * the same CLI serves Functions, background work, redirects and app Blobs. */
export function devOptions({ local = false, readOnly = false, environment = process.env } = {}) {
  const client = path.join(root, 'client'), certificate = path.join(root, 'deployment/.local/certificates/localhost.pem');
  const cliState = path.join(client, '.netlify/cli');
  const env = { ...environment, TIMELINE_NETLIFY_DEV: 'true', NETLIFY_TELEMETRY_DISABLED: '1', NO_UPDATE_NOTIFIER: '1',
    // Keep offline CLI configuration and cache within this ignored app state.
    // These overrides apply only to the child process, never the user's shell.
    APPDATA: cliState, LOCALAPPDATA: cliState, XDG_CONFIG_HOME: cliState, XDG_CACHE_HOME: cliState, XDG_DATA_HOME: cliState };
  const args = [path.join(client, 'node_modules/netlify-cli/bin/run.js'), 'dev', '--offline', '--no-open', '--skip-gitignore', '--internal-disable-edge-functions'];
  if (local) {
    if (!fs.existsSync(certificate)) throw new Error('The explicit M0 profile requires its existing local HTTPS certificate.');
    env.TIMELINE_LOCAL_PROFILE = 'true'; env.TIMELINE_LOCAL_WORKSPACE = root; env.TIMELINE_MODE = 'm0-local'; env.NODE_EXTRA_CA_CERTS = certificate;
    args.push('--command', 'npm --prefix client run dev:app -- --mode m0-local');
  } else if (readOnly) {
    env.TIMELINE_MODE = 'production-readonly';
    args.push('--command', 'npm --prefix client run dev:app -- --mode production-readonly');
  }
  if (readOnly) env.TIMELINE_READ_ONLY = 'true';
  return { command: process.execPath, args, options: { cwd: root, stdio: 'inherit', env } };
}
export async function startDev(options = {}) {
  const launch = devOptions(options);
  if (options.providerTestKeys) {
    if (!options.local) throw new Error('Production provider test keys require the explicit isolated --local profile.');
    const { loadProductionProviderTestKeys } = await import('./lib/m1-provider-test-secrets.mjs');
    Object.assign(launch.options.env, await loadProductionProviderTestKeys({ environment: launch.options.env }));
  }
  let blobs;
  if (options.local) {
    const { startLocalBlobs } = await import('./lib/netlify-blobs-local.mjs');
    blobs = await startLocalBlobs({ directory: path.join(root, 'deployment/.local/netlify-app-blobs'), siteID: 'timeline-theories-m0-local' });
    Object.assign(launch.options.env, { TIMELINE_LOCAL_BLOB_ENDPOINT: blobs.url, TIMELINE_LOCAL_BLOB_SITE_ID: blobs.siteID, TIMELINE_LOCAL_BLOB_TOKEN: blobs.token });
  }
  const child = spawn(launch.command, launch.args, launch.options);
  child.once('error', error => { console.error('Netlify Dev could not start:', error.message); process.exitCode = 1; void blobs?.close(); });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); void blobs?.close(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  return child;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(value => !['--local', '--readonly', '--production-provider-keys'].includes(value))) throw new Error('Usage: node scripts/m1-dev.mjs [--local] [--readonly] [--production-provider-keys]');
  await startDev({ local: process.argv.includes('--local'), readOnly: process.argv.includes('--readonly'), providerTestKeys: process.argv.includes('--production-provider-keys') });
}
