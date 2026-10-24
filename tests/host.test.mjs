import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { attachHost } from '../src/host.mjs';

function fixture(rejection) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => child.emit('exit', 0);
  const messages = []; let text = '';
  child.stdin.on('data', chunk => { text += chunk; let i; while ((i = text.indexOf('\n')) >= 0) { messages.push(JSON.parse(text.slice(0, i))); text = text.slice(i + 1); } });
  let route; let removed = false;
  const ctx = { get: () => ({ requestRejection: () => rejection }), logger: { warn() {} }, webServer: { register(r) { route = r; return () => { removed = true; }; } } };
  const dispose = attachHost(ctx, () => child);
  async function request(body, method = 'POST') {
    const req = Readable.from([JSON.stringify(body)]); req.method = method; req.socket = { remoteAddress: '127.0.0.1' };
    let status; let data;
    await route.handler(req, { writeHead(s) { status = s; }, end(value) { data = JSON.parse(value); } });
    return { status, data };
  }
  return { child, messages, request, dispose: () => { dispose(); child.emit('exit', 0); child.stdin.end(); child.stdout.end(); child.stderr.end(); assert.equal(removed, true); } };
}
test('host route delivers native payload only to the original session then acknowledges it', async () => {
  const f = fixture();
  try {
    assert.equal((await f.request({ action: 'sync', clientId: 'one', sessionId: 'a' })).status, 200);
    await f.request({ action: 'open', clientId: 'one', sessionId: 'a' });
    const show = f.messages.find(m => m.type === 'show'); assert.equal(show.sessionId, 'a');
    f.child.stdout.write(JSON.stringify({ type: 'submit', id: show.id, question: '请解释截图', image: null }) + '\n');
    assert.equal(f.messages.at(-1).type, 'queued');
    assert.equal((await f.request({ action: 'sync', clientId: 'one', sessionId: 'b' })).data.item, null);
    assert.equal((await f.request({ action: 'sync', clientId: 'one', sessionId: 'a' })).data.item.question, '请解释截图');
    await f.request({ action: 'ack', clientId: 'one', id: show.id });
    assert.equal(f.messages.at(-1).type, 'delivered');
  } finally { f.dispose(); }
});
test('host rejects unauthorized calls and unsupported methods without launching popup', async () => {
  const f = fixture(401);
  try { assert.equal((await f.request({ action: 'open' })).status, 401); assert.equal(f.messages.length, 0); } finally { f.dispose(); }
  const g = fixture();
  try { assert.equal((await g.request({}, 'GET')).status, 405); } finally { g.dispose(); }
});
test('native validation error permits retry instead of trapping disabled composer', async () => {
  const f = fixture();
  try {
    await f.request({ action: 'open', clientId: 'one', sessionId: 'a' });
    const { id } = f.messages.at(-1);
    f.child.stdout.write(JSON.stringify({ type: 'submit', id, question: ' ' }) + '\n');
    assert.deepEqual(f.messages.at(-1).retry, true);
  } finally { f.dispose(); }
});
