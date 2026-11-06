import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readProfile, validateProfile } from '../client/profile.mjs';
import { startDev } from './m1-dev.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modes = ['m0-local', 'development', 'production-readonly'];
const relayPorts = [41016, 41017];
const publicKeys = ['VITE_SENSENET_REPO_URL', 'VITE_OIDC_AUTHORITY', 'VITE_OIDC_CLIENT_ID', 'VITE_AUTH_TYPE', 'VITE_PROJECT_ROOT_PATH', 'VITE_READ_ONLY'];
const loopbackAddresses = new net.BlockList();
loopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
loopbackAddresses.addAddress('::1', 'ipv6');
const loopback = host => {
  host = host.replace(/^\[|\]$/g, '');
  const family = net.isIP(host);
  return host === 'localhost' || host.endsWith('.localhost') || Boolean(family && loopbackAddresses.check(host, family === 6 ? 'ipv6' : 'ipv4'));
};

export function validateRelayHost(value = 'host.docker.internal') {
  if (typeof value !== 'string' || !value || value.length > 253 || /[\s/@?#\\]/.test(value)) throw new Error('TIMELINE_DOCKER_HOST must be a bare host name or IP address.');
  const host = value.replace(/^\[|\]$/g, '');
  const ip = net.isIP(host);
  if (!ip && (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) || host.split('.').some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-')))) throw new Error('TIMELINE_DOCKER_HOST must be a bare host name or IP address.');
  if (loopback(host.toLowerCase()) || ['0.0.0.0', '::', '::ffff:0.0.0.0', '::ffff:0:0', '255.255.255.255'].includes(host.toLowerCase())) throw new Error('The relay target must be the Docker host, outside the container loopback.');
  return host;
}

export function profileRelayPorts(profile) {
  const ports = new Set();
  for (const value of [profile.repositoryUrl, profile.authority]) {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!loopback(host)) continue;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host) || !relayPorts.includes(Number(url.port))) throw new Error('Container loopback targets must use localhost, 127.0.0.1 or ::1 on ports 41016/41017.');
    ports.add(Number(url.port));
  }
  return [...ports].sort();
}

/** Pure selection: the same public target is passed to Vite and Functions. */
export function containerOptions(environment = {}, { baseProfile, mountedProfile, workspace = root } = {}) {
  const mode = environment.TIMELINE_DOCKER_PROFILE ?? 'm0-local';
  if (!modes.includes(mode)) throw new Error('TIMELINE_DOCKER_PROFILE must be m0-local, development or production-readonly.');
  for (const key of publicKeys) if (environment[key] !== undefined && typeof environment[key] !== 'string') throw new Error(`${key} must be a string.`);
  if (environment.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Container development requires TLS certificate verification.');
  const selected = { ...environment };
  if (mode === 'm0-local' && !selected.VITE_OIDC_CLIENT_ID?.trim()) {
    selected.VITE_OIDC_CLIENT_ID = [mountedProfile?.clientId, baseProfile?.clientId].find(value => typeof value === 'string' && value.trim()) || '';
  }
  // readProfile supplies the app's existing auth aliases, HTTPS-origin and
  // public-setting validation without reading any .env files.
  const configured = readProfile(mode === 'm0-local' ? 'development' : mode, '', selected);
  const { mode: ignoredMode, ...publicProfile } = configured;
  const profile = validateProfile(publicProfile, mode);
  if (mode === 'm0-local' && (profile.repositoryUrl !== 'https://localhost:41016' || profile.authority !== 'https://localhost:41017')) throw new Error('M0 requires https://localhost:41016 and https://localhost:41017.');
  const ports = profileRelayPorts(profile);
  Object.assign(selected, {
    VITE_SENSENET_REPO_URL: profile.repositoryUrl, VITE_OIDC_AUTHORITY: profile.authority,
    VITE_OIDC_CLIENT_ID: profile.clientId, VITE_AUTH_TYPE: profile.authType,
    VITE_PROJECT_ROOT_PATH: profile.projectRoot, VITE_READ_ONLY: String(!profile.writable),
    TIMELINE_MODE: mode, TIMELINE_REPOSITORY_URL: profile.repositoryUrl,
    TIMELINE_AUTHORITY: profile.authority, TIMELINE_PROJECT_ROOT: profile.projectRoot,
    TIMELINE_READ_ONLY: String(!profile.writable),
  });
  // Inherited local flags must never select M0 behind a remote profile's back.
  delete selected.TIMELINE_LOCAL_PROFILE;
  delete selected.TIMELINE_LOCAL_WORKSPACE;
  if (ports.length) selected.NODE_EXTRA_CA_CERTS = path.join(workspace, 'deployment/.local/certificates/localhost.pem');
  return { mode, local: mode === 'm0-local', readOnly: mode === 'production-readonly', profile,
    override: mode === 'm0-local' ? publicProfile : undefined, environment: selected,
    relay: ports.length ? { host: validateRelayHost(environment.TIMELINE_DOCKER_HOST), ports } : undefined };
}

/** TCP only: TLS bytes, localhost SNI and certificate verification stay intact.
 * Test seams can use ephemeral listen ports while production ports stay fixed. */
export async function startLoopbackRelays({ host = 'host.docker.internal', ports = relayPorts } = {}, {
  createServer = net.createServer, connect = net.createConnection,
  listenPort = port => port, listenHosts = ['127.0.0.1', '::1'],
} = {}) {
  host = validateRelayHost(host);
  if (!Array.isArray(ports) || !ports.length || new Set(ports).size !== ports.length || ports.some(port => !relayPorts.includes(port))) throw new Error('Only the fixed M0 target ports 41016/41017 can be relayed.');
  if (!Array.isArray(listenHosts) || !listenHosts.length || listenHosts.some(value => !['127.0.0.1', '::1'].includes(value))) throw new Error('Target relays must listen on loopback only.');
  const servers = [], sockets = new Set();
  let closing;
  const close = () => closing ||= (async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(server => new Promise(resolve => server.close(() => resolve()))));
  })();
  const accept = (incoming, port) => {
    if (sockets.size >= 128 || closing) { incoming.destroy(); return; }
    sockets.add(incoming);
    let outgoing;
    const destroy = () => { incoming.destroy(); outgoing?.destroy(); };
    incoming.on('error', destroy);
    incoming.once('close', () => { sockets.delete(incoming); outgoing?.destroy(); });
    incoming.setTimeout(120_000, destroy);
    try { outgoing = connect({ host, port }); }
    catch { destroy(); return; }
    outgoing.on('error', destroy);
    outgoing.once('close', () => incoming.destroy());
    outgoing.setTimeout(10_000, destroy);
    outgoing.once('connect', () => outgoing.setTimeout(120_000));
    incoming.pipe(outgoing).pipe(incoming);
  };
  try {
    for (const port of ports) for (const listenHost of listenHosts) {
      const server = createServer(incoming => accept(incoming, port));
      servers.push(server);
      await new Promise((resolve, reject) => {
        const failed = error => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', failed); server.on('error', () => { void close(); }); resolve(); };
        server.once('error', failed); server.once('listening', ready);
        server.listen({ host: listenHost, port: listenPort(port), ...(listenHost === '::1' ? { ipv6Only: true } : {}) });
      });
    }
  } catch (error) { await close(); throw error; }
  return { close, addresses: servers.map(server => server.address()) };
}

async function readPublicProfile(file, optional = false) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw new Error('The container public local profile is unavailable or invalid.');
  }
}

export async function startContainer({ environment = process.env, workspace = root, mountedProfilePath = '/run/timeline/profiles/local.override.json' } = {}, {
  startApp = startDev, startRelays = startLoopbackRelays,
} = {}) {
  const local = (environment.TIMELINE_DOCKER_PROFILE ?? 'm0-local') === 'm0-local';
  const baseProfile = local ? await readPublicProfile(path.join(workspace, 'client/profiles/local.json')) : undefined;
  const mountedProfile = local && !environment.VITE_OIDC_CLIENT_ID?.trim() ? await readPublicProfile(mountedProfilePath, true) : undefined;
  const options = containerOptions(environment, { baseProfile, mountedProfile, workspace });
  if (options.local) await fs.writeFile(path.join(workspace, 'client/profiles/local.override.json'), `${JSON.stringify(options.override, null, 2)}\n`);
  const relays = options.relay ? await startRelays(options.relay) : undefined;
  let child;
  try { child = await startApp({ local: options.local, readOnly: options.readOnly, environment: options.environment }); }
  catch (error) { await relays?.close(); throw error; }
  const cleanup = () => { void relays?.close(); };
  child.once('exit', cleanup); child.once('error', cleanup);
  return { child, options, close: async () => { child.kill('SIGTERM'); await relays?.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/local-app-container.mjs');
    await startContainer();
  } catch (error) { console.error('Container app startup failed:', error.message); process.exitCode = 1; }
}
