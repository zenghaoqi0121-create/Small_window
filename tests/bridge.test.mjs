import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Bridge, authorize, readBody } from '../src/bridge.mjs';
const png = Buffer.from('89504e470d0a1a0a010203', 'hex').toString('base64');
test('hotkey requires fresh selected session', () => {
  let now = 0; const b = new Bridge(() => now);
  assert.throws(() => b.open()); b.sync('one', 'a'); now = 10001; assert.throws(() => b.open());
});
test('capture stays pinned across session changes and other clients', () => {
  const b = new Bridge(); b.sync('one', 'a'); const open = b.open();
  b.sync('one', 'b'); b.accept({ id: open.id, question: '截图的问题', image: png });
  assert.equal(b.sync('one', 'b'), null); assert.equal(b.sync('two', 'a'), null);
  assert.equal(b.sync('one', 'a').sessionId, 'a');
  assert.equal(b.ack('two', open.id), false); assert.equal(b.ack('one', open.id), true);
  assert.equal(b.sync('one', 'a'), null);
});
test('pending capture blocks another submission; invalid payload preserves open target', () => {
  const b = new Bridge(); b.sync('one', 'a'); const { id } = b.open();
  assert.throws(() => b.accept({ id, question: 'x', image: 'bad' }));
  assert.throws(() => b.accept({ id, question: '  ' }));
  assert.throws(() => b.accept({ id: 'wrong', question: 'x' }));
  b.accept({ id, question: 'x' }); assert.throws(() => b.open());
});
test('captures expire after ten minutes', () => {
  let now = 0; const b = new Bridge(() => now); b.sync('one', 'a'); const { id } = b.open();
  b.accept({ id, question: 'x' }); now = 600000; assert.equal(b.sync('one', 'a'), null);
});
test('authorization fails closed for remote or missing host authentication', () => {
  const req = { socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(authorize({ get: () => null }, req), 503);
  assert.equal(authorize({ get: () => ({ requestRejection: () => 401 }) }, req), 401);
  assert.equal(authorize({ get: () => ({ requestRejection: () => undefined }) }, req), undefined);
  assert.equal(authorize({ get: () => ({ requestRejection: () => undefined }) }, { socket: { remoteAddress: '192.168.0.2' } }), 403);
});
test('request size is bounded', async () => {
  assert.deepEqual(await readBody(Readable.from(['{"action":"sync"}'])), { action: 'sync' });
  await assert.rejects(readBody(Readable.from(['x'.repeat(4097)])));
});
