import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchPermissionRows } from '../client/services/permissionRequest.mjs';

async function server(t, handler) {
  const sockets = new Set();
  const instance = http.createServer(handler);
  instance.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => instance.close(resolve));
  });
  return 'http://127.0.0.1:' + instance.address().port;
}

test('one compound permission GET succeeds and releases its deadline without retries', async t => {
  let calls = 0;
  const url = await server(t, (request, response) => {
    calls++; assert.equal(request.method, 'GET');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ d: { results: [{ Id: 3 }] } }));
  });
  const rows = await fetchPermissionRows((url, init, awaitReady) => {
    assert.equal(awaitReady, false); assert(init.signal instanceof AbortSignal);
    return fetch(url, init);
  }, url, 2000);
  assert.deepEqual(rows, [{ Id: 3 }]); assert.equal(calls, 1);
});

for (const phase of ['headers', 'body']) test(`permission deadline covers a stalled ${phase} and aborts the transport`, async t => {
  let signal, calls = 0;
  const url = await server(t, (_request, response) => {
    calls++;
    if (phase === 'body') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{"d":'); }
  });
  const start = Date.now();
  await assert.rejects(fetchPermissionRows((url, init) => { signal = init.signal; return fetch(url, init); }, url, 150), /timed out/);
  assert(signal.aborted); assert.equal(calls, 1);
  assert(Date.now() - start < 2000, 'Bounded absolute deadline rather than indefinite socket inactivity');
});

test('even a non-cooperative transport cannot keep the UI pending past the deadline', async () => {
  let signal;
  await assert.rejects(fetchPermissionRows((_url, init) => {
    signal = init.signal; return new Promise(() => {});
  }, 'https://repository.test/odata.svc', 20), /timed out/);
  assert(signal.aborted);
});

test('known forbidden or absent responses are denial; outages and invalid bodies remain unavailable', async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    await assert.rejects(fetchPermissionRows(async () => new Response('{}', { status }), 'https://repository.test'), error =>
      error.permissionUnavailable === ![401, 403, 404].includes(status));
  }
  for (const body of ['not json', '{}', '{"d":{}}']) {
    await assert.rejects(fetchPermissionRows(async () => new Response(body), 'https://repository.test'), error =>
      error.permissionUnavailable !== false);
  }
});
