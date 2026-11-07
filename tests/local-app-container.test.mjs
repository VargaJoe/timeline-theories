import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { EventEmitter, once } from 'node:events';
import { containerOptions, profileRelayPorts, startContainer, startLoopbackRelays, validateRelayHost } from '../scripts/local-app-container.mjs';
import { readProfile } from '../client/profile.mjs';

const localEnv = {
  VITE_SENSENET_REPO_URL: 'https://localhost:41016', VITE_OIDC_AUTHORITY: 'https://localhost:41017',
  VITE_AUTH_TYPE: 'oidc', VITE_PROJECT_ROOT_PATH: '/Root/Content/timelines', VITE_READ_ONLY: 'false',
};
const remoteEnv = { ...localEnv, TIMELINE_DOCKER_PROFILE: 'development',
  VITE_SENSENET_REPO_URL: 'https://repository.example', VITE_OIDC_AUTHORITY: 'https://identity.example', VITE_OIDC_CLIENT_ID: 'remote-public' };
const baseProfile = { repositoryUrl: localEnv.VITE_SENSENET_REPO_URL, authority: localEnv.VITE_OIDC_AUTHORITY,
  authType: 'IdentityServer', projectRoot: '/Root/Content/timelines', clientId: 'base-public', writable: true };

test('M0 public env is the single UI/backend target; stale backend aliases cannot redirect it', () => {
  const input = { ...localEnv, VITE_OIDC_CLIENT_ID: 'explicit-public', TIMELINE_REPOSITORY_URL: 'https://stale.example',
    TIMELINE_AUTHORITY: 'https://stale-auth.example', TIMELINE_PROJECT_ROOT: '/Root/Content/stale', TIMELINE_READ_ONLY: 'true' };
  const selected = containerOptions(input, { baseProfile, workspace: '/app' });
  assert.equal(selected.mode, 'm0-local'); assert.equal(selected.local, true);
  assert.deepEqual(selected.override, { ...baseProfile, clientId: 'explicit-public' });
  assert.deepEqual(selected.relay, { host: 'host.docker.internal', ports: [41016, 41017] });
  assert.equal(selected.environment.TIMELINE_REPOSITORY_URL, selected.profile.repositoryUrl);
  assert.equal(selected.environment.TIMELINE_AUTHORITY, selected.profile.authority);
  assert.equal(selected.environment.TIMELINE_PROJECT_ROOT, selected.profile.projectRoot);
  assert.equal(selected.environment.TIMELINE_READ_ONLY, 'false');
  assert.equal(selected.environment.VITE_AUTH_TYPE, 'IdentityServer');
  assert.equal(selected.environment.NODE_EXTRA_CA_CERTS, path.join('/app', 'deployment/.local/certificates/localhost.pem'));
  assert.equal(input.TIMELINE_REPOSITORY_URL, 'https://stale.example');
});

test('M0 client ID precedence is environment, readonly mounted override, then local profile', () => {
  const mountedProfile = { clientId: 'mounted-public', repositoryUrl: 'https://ignored.example' };
  for (const [value, expected] of [['env-public', 'env-public'], ['', 'mounted-public'], ['  ', 'mounted-public']]) {
    assert.equal(containerOptions({ ...localEnv, VITE_OIDC_CLIENT_ID: value }, { baseProfile, mountedProfile }).profile.clientId, expected);
  }
  assert.equal(containerOptions(localEnv, { baseProfile }).profile.clientId, 'base-public');
});

test('remote development preserves configured HTTPS origins and never starts local routing', () => {
  const selected = containerOptions({ ...remoteEnv, TIMELINE_LOCAL_PROFILE: 'true', TIMELINE_LOCAL_WORKSPACE: '/stale', NODE_EXTRA_CA_CERTS: '/existing.pem' });
  assert.equal(selected.local, false); assert.equal(selected.readOnly, false);
  assert.equal(selected.profile.repositoryUrl, remoteEnv.VITE_SENSENET_REPO_URL);
  assert.equal(selected.profile.authority, remoteEnv.VITE_OIDC_AUTHORITY);
  assert.equal(selected.profile.clientId, remoteEnv.VITE_OIDC_CLIENT_ID);
  assert.equal(selected.environment.TIMELINE_LOCAL_PROFILE, undefined);
  assert.equal(selected.environment.TIMELINE_LOCAL_WORKSPACE, undefined);
  assert.equal(selected.environment.NODE_EXTRA_CA_CERTS, '/existing.pem');
  assert.equal(selected.relay, undefined); assert.equal(selected.override, undefined);
});

test('production-readonly mode makes UI and Functions readonly even when the copied default is false', () => {
  const selected = containerOptions({ ...remoteEnv, TIMELINE_DOCKER_PROFILE: 'production-readonly' });
  assert.equal(selected.readOnly, true); assert.equal(selected.profile.writable, false);
  assert.equal(selected.environment.VITE_READ_ONLY, 'true'); assert.equal(selected.environment.TIMELINE_READ_ONLY, 'true');
  assert.equal(selected.profile.repositoryUrl, remoteEnv.VITE_SENSENET_REPO_URL);
});

test('development read-only env remains development and reaches both UI and Functions', () => {
  const selected = containerOptions({ ...remoteEnv, VITE_READ_ONLY: 'true' });
  assert.equal(selected.mode, 'development'); assert.equal(selected.readOnly, false);
  assert.equal(selected.profile.writable, false); assert.equal(selected.environment.TIMELINE_READ_ONLY, 'true');
});

test('invalid profile, auth, root, TLS and read-only inputs fail before startup', () => {
  const invalid = [
    { TIMELINE_DOCKER_PROFILE: 'production' }, { TIMELINE_DOCKER_PROFILE: '' },
    { VITE_AUTH_TYPE: 'unknown' }, { VITE_READ_ONLY: 'yes' }, { VITE_READ_ONLY: 'true' },
    { VITE_PROJECT_ROOT_PATH: '/Root/Content/../private' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { VITE_SENSENET_REPO_URL: 'https://remote.example' }, { VITE_SENSENET_REPO_URL: 'https://127.0.0.1:41016' },
    { VITE_SENSENET_REPO_URL: '' }, { VITE_OIDC_AUTHORITY: '' },
    { VITE_SENSENET_REPO_URL: 'http://localhost:41016' }, { VITE_OIDC_AUTHORITY: 'https://localhost:41017/path' },
    { VITE_OIDC_AUTHORITY: 'https://user:password@localhost:41017' }, { VITE_OIDC_AUTHORITY: 'https://localhost:41017?x=1' },
    { VITE_OIDC_CLIENT_ID: 42 },
  ];
  for (const change of invalid) assert.throws(() => containerOptions({ ...localEnv, ...change }, { baseProfile }));
});

test('ordinary loopback mode only relays supported origins and fixed target ports', () => {
  const selected = containerOptions({ ...remoteEnv, VITE_SENSENET_REPO_URL: 'https://127.0.0.1:41016', VITE_OIDC_AUTHORITY: 'https://[::1]:41017' });
  assert.deepEqual(selected.relay.ports, [41016, 41017]);
  for (const value of ['https://localhost:443', 'https://127.0.0.1:9999', 'https://127.0.0.2:41016', 'https://alias.localhost:41016', 'https://[::ffff:127.0.0.1]:41016']) {
    assert.throws(() => containerOptions({ ...remoteEnv, VITE_SENSENET_REPO_URL: value }), /loopback targets/);
  }
  assert.deepEqual(profileRelayPorts({ repositoryUrl: 'https://localhost:41016', authority: 'https://localhost:41016' }), [41016]);
});

test('relay target accepts a Docker gateway host or address, rejecting URLs, ports and self-routing', () => {
  for (const value of ['host.docker.internal', 'docker-gateway', '172.17.0.1', 'fd00::1']) assert.equal(validateRelayHost(value), value);
  for (const value of ['', 'https://gateway', 'gateway:41016', 'user@gateway', 'gateway/path', 'gateway?x', 'gateway#x', 'a b', 'localhost', '127.0.0.1', '127.3.2.1', '::1', '[::1]', '::ffff:127.0.0.1', '::ffff:7f00:1', '0.0.0.0', '::', '-gateway']) assert.throws(() => validateRelayHost(value));
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'timeline-container-'));
  t.after(async () => { if (path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(directory, { recursive: true, force: true }); });
  await fs.mkdir(path.join(directory, 'client/profiles'), { recursive: true });
  await fs.writeFile(path.join(directory, 'client/profiles/local.json'), JSON.stringify(baseProfile));
  return directory;
}

test('launcher writes an ephemeral convergent profile and reuses the complete app runner', async t => {
  const workspace = await fixture(t), mountedProfilePath = path.join(workspace, 'mounted.json');
  await fs.writeFile(mountedProfilePath, JSON.stringify({ clientId: 'mounted-public' }));
  const mountedBefore = await fs.readFile(mountedProfilePath, 'utf8');
  const child = new EventEmitter(); child.kill = () => {};
  let launched, closed = 0;
  const running = await startContainer({ environment: localEnv, workspace, mountedProfilePath }, {
    startApp: async options => { launched = options; return child; },
    startRelays: async options => { assert.deepEqual(options.ports, [41016, 41017]); return { close: async () => { closed++; } }; },
  });
  const uiProfile = readProfile('m0-local', path.join(workspace, 'client'));
  assert.deepEqual(uiProfile, running.options.profile);
  assert.equal(uiProfile.clientId, 'mounted-public');
  assert.equal(launched.local, true); assert.equal(launched.readOnly, false);
  assert.equal(launched.environment.TIMELINE_REPOSITORY_URL, uiProfile.repositoryUrl);
  assert.equal(launched.environment.TIMELINE_AUTHORITY, uiProfile.authority);
  assert.equal(launched.environment.TIMELINE_PROJECT_ROOT, uiProfile.projectRoot);
  assert.equal(await fs.readFile(mountedProfilePath, 'utf8'), mountedBefore);
  child.emit('exit', 0); await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, 1);
});

test('remote launcher neither writes an M0 override nor starts relays', async t => {
  const workspace = await fixture(t), child = new EventEmitter(); child.kill = () => {};
  let launched;
  await startContainer({ environment: remoteEnv, workspace }, {
    startApp: async options => { launched = options; return child; },
    startRelays: async () => { assert.fail('remote startup must not relay'); },
  });
  assert.equal(launched.local, false); assert.equal(launched.readOnly, false);
  await assert.rejects(fs.access(path.join(workspace, 'client/profiles/local.override.json')));
});

test('app launch failure closes all already-started relays', async t => {
  const workspace = await fixture(t); let closed = 0;
  await assert.rejects(startContainer({ environment: localEnv, workspace, mountedProfilePath: path.join(workspace, 'absent.json') }, {
    startApp: async () => { throw new Error('start failed'); }, startRelays: async () => ({ close: async () => { closed++; } }),
  }), /start failed/);
  assert.equal(closed, 1);
});

test('relay forwards binary bytes unchanged, uses only its configured target, and cleans active sockets', async t => {
  const upstreamSockets = new Set();
  const upstream = net.createServer(socket => { upstreamSockets.add(socket); socket.on('close', () => upstreamSockets.delete(socket)); socket.pipe(socket); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(async () => { for (const socket of upstreamSockets) socket.destroy(); await new Promise(resolve => upstream.close(resolve)); });
  const requested = [];
  const relay = await startLoopbackRelays({ host: 'host.docker.internal', ports: [41016] }, {
    listenPort: () => 0, listenHosts: ['127.0.0.1'],
    connect: options => { requested.push(options); return net.createConnection({ host: '127.0.0.1', port: upstream.address().port }); },
  });
  t.after(() => relay.close());
  const address = relay.addresses[0]; assert.equal(address.address, '127.0.0.1');
  const socket = net.createConnection({ host: address.address, port: address.port });
  socket.on('error', () => {}); await once(socket, 'connect');
  const payload = Buffer.from([0, 255, 22, 3, 1, 0, 8, 47, 92, 13, 10]);
  const reply = once(socket, 'data'); socket.write(payload);
  assert.deepEqual((await reply)[0], payload);
  assert.deepEqual(requested, [{ host: 'host.docker.internal', port: 41016 }]);
  const disconnected = once(socket, 'close'); await relay.close(); await disconnected;
  await relay.close();
  const refused = net.createConnection({ host: address.address, port: address.port });
  const [error] = await once(refused, 'error'); assert.equal(error.code, 'ECONNREFUSED');
});

test('relay rejects unsafe listening/target ports and rolls back partial listener startup', async () => {
  await assert.rejects(startLoopbackRelays({ ports: [443] }), /fixed M0/);
  await assert.rejects(startLoopbackRelays({ ports: [41016, 41016] }), /fixed M0/);
  await assert.rejects(startLoopbackRelays({}, { listenHosts: ['0.0.0.0'] }), /loopback only/);
  const created = [];
  await assert.rejects(startLoopbackRelays({ ports: [41016, 41017] }, {
    listenPort: () => 0, listenHosts: ['127.0.0.1'], createServer: accept => {
      const server = net.createServer(accept); created.push(server);
      if (created.length === 2) server.listen = () => { queueMicrotask(() => server.emit('error', Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }))); };
      return server;
    },
  }), /occupied/);
  assert.ok(created.every(server => !server.listening));
});
