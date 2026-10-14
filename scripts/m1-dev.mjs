import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The only public app origin is Netlify Dev. Vite is its internal UI server;
 * the same CLI serves Functions, background work, redirects and app Blobs. */
export function devOptions({ local = false, readOnly = false, environment = process.env } = {}, { certificateExists = fs.existsSync } = {}) {
  const client = path.join(root, 'client'), certificate = path.join(root, 'deployment/.local/certificates/localhost.pem');
  if (!certificateExists(certificate)) throw new Error('Netlify app development requires its existing local HTTPS certificate.');
  const cliState = path.join(client, '.netlify/cli');
  const env = { ...environment, TIMELINE_NETLIFY_DEV: 'true', TIMELINE_APP_DEV_CA_FILE: certificate, NETLIFY_TELEMETRY_DISABLED: '1', NO_UPDATE_NOTIFIER: '1',
    // Keep offline CLI configuration and cache within this ignored app state.
    // These overrides apply only to the child process, never the user's shell.
    APPDATA: cliState, LOCALAPPDATA: cliState, XDG_CONFIG_HOME: cliState, XDG_CACHE_HOME: cliState, XDG_DATA_HOME: cliState };
  const args = [path.join(client, 'node_modules/netlify-cli/bin/run.js'), 'dev', '--offline', '--no-open', '--skip-gitignore', '--internal-disable-edge-functions'];
  if (local) {
    env.TIMELINE_LOCAL_PROFILE = 'true'; env.TIMELINE_LOCAL_WORKSPACE = root; env.TIMELINE_MODE = 'm0-local'; env.NODE_EXTRA_CA_CERTS = certificate;
    args.push('--command', 'npm --prefix client run dev:app -- --mode m0-local');
  } else if (readOnly) {
    env.TIMELINE_MODE = 'production-readonly';
    args.push('--command', 'npm --prefix client run dev:app -- --mode production-readonly');
  }
  if (readOnly) env.TIMELINE_READ_ONLY = 'true';
  return { command: process.execPath, args, options: { cwd: root, stdio: 'inherit', env } };
}
export async function startDev(options = {}, { openBlobs, spawnProcess = spawn, certificateExists } = {}) {
  const launch = devOptions(options, { certificateExists });
  if (options.providerTestKeys) {
    if (!options.local) throw new Error('Production provider test keys require the explicit isolated --local profile.');
    const { loadProductionProviderTestKeys } = await import('./lib/m1-provider-test-secrets.mjs');
    Object.assign(launch.options.env, await loadProductionProviderTestKeys({ environment: launch.options.env }));
  }
  const startBlobs = openBlobs || (await import('./lib/netlify-blobs-local.mjs')).startLocalBlobs;
  // App-local persistence is independent of repository selection. Binding
  // prefixes keep configured targets isolated inside this same private store.
  const blobs = await startBlobs({ directory: path.join(root, 'deployment/.local/netlify-app-blobs'), siteID: 'timeline-theories-m0-local' });
  Object.assign(launch.options.env, { TIMELINE_LOCAL_BLOB_ENDPOINT: blobs.url, TIMELINE_LOCAL_BLOB_SITE_ID: blobs.siteID, TIMELINE_LOCAL_BLOB_TOKEN: blobs.token });
  let child;
  try { child = spawnProcess(launch.command, launch.args, launch.options); }
  catch (error) { await blobs.close(); throw error; }
  const signals = ['SIGINT', 'SIGTERM'].map(signal => [signal, () => child.kill(signal)]);
  let closed = false;
  const close = () => { if (closed) return; closed = true; for (const [signal, handler] of signals) process.off(signal, handler); void blobs.close(); };
  child.once('error', error => { console.error('Netlify Dev could not start:', error.message); process.exitCode = 1; close(); });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); close(); });
  for (const [signal, handler] of signals) process.once(signal, handler);
  return child;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(value => !['--local', '--readonly', '--production-provider-keys'].includes(value))) throw new Error('Usage: node scripts/m1-dev.mjs [--local] [--readonly] [--production-provider-keys]');
  await startDev({ local: process.argv.includes('--local'), readOnly: process.argv.includes('--readonly'), providerTestKeys: process.argv.includes('--production-provider-keys') });
}
