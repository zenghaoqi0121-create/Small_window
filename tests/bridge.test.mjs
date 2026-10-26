import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Bridge, authorize, readBody, REQUEST_LIMIT } from '../src/bridge.mjs';
const png = Buffer.from('89504e470d0a1a0a010203', 'hex').toString('base64');
function ready(now) { const b = new Bridge(now); b.heartbeat('one','a','会话 A'); const target = b.open(); return { b, target }; }
test('hotkey requires a fresh selection initially, then stays pinned indefinitely', () => {
  let now = 0; const b = new Bridge(() => now); assert.throws(() => b.open());
  b.heartbeat('one','a'); now = 10001; assert.throws(() => b.open());
  b.heartbeat('one','a'); const target = b.open(); now += 1000000; b.heartbeat('one','b'); assert.equal(b.open().id,target.id);
});
test('image-only sends default prompt; text-only preserves text', () => {
  const { b,target } = ready(); const c = b.submit({ bindingId: target.id, requestId:'r1', question:' ',image:png });
  assert.equal(c.question,'请分析这张截图。');
  b.receipt('one',{ bindingId:target.id,requestId:'r1',status:'accepted' });
  assert.equal(b.submit({ bindingId:target.id,requestId:'r2',question:'  继续说明\n' }).question,'  继续说明\n');
});
test('opaque Harness session ids are not restricted to UUID characters', () => {
  const b = new Bridge(); b.heartbeat('one', 'workspace:agent.1');
  assert.equal(b.open().sessionId, 'workspace:agent.1');
});
test('empty, invalid PNG and mismatched targets never issue a send', () => {
  const { b,target } = ready();
  for (const fields of [{question:' '},{question:'x',image:'bad'},{question:'x',bindingId:'wrong'}])
    assert.throws(() => b.submit({ bindingId:target.id,requestId:'r',...fields }));
  assert.equal(b.pending,null);
});
test('command is issued once only to its original client regardless of main session', () => {
  const { b,target } = ready(); b.submit({ bindingId:target.id,requestId:'r1',question:'x' });
  b.heartbeat('one','b');
  assert.equal(b.take('two').command,null);
  assert.equal(b.take('one').command.sessionId,'a');
  assert.equal(b.take('one').command,null);
  assert.equal(b.submit({ bindingId:target.id,requestId:'r1',question:'x' }),null);
  assert.equal(b.receipt('two',{ bindingId:target.id,requestId:'r1',status:'accepted' }),null);
});
test('only explicit clean rebind switches target; pending submissions block it', () => {
  const { b,target } = ready(); b.heartbeat('one','b');
  assert.equal(b.open().id,target.id);
  b.dirty = true; assert.throws(() => b.open(b.active)); b.dirty = false;
  b.submit({ bindingId:target.id,requestId:'r1',question:'x' });
  assert.throws(() => b.open(b.active));
  b.receipt('one',{ bindingId:target.id,requestId:'r1',status:'accepted' });
  assert.equal(b.open(b.active).sessionId,'b');
});
test('missing confirmation times out without replay; late acceptance resolves it', () => {
  let now = 0; const { b,target } = ready(() => now);
  b.submit({ bindingId:target.id,requestId:'r1',question:'x',image:png }); b.take('one'); now=30000;
  assert.equal(b.timeout().status,'unknown'); assert.equal(b.take('one').command,null);
  assert.equal(b.commands.get('r1').image,null);
  assert.equal(b.receipt('one',{ bindingId:target.id,requestId:'r1',status:'accepted' }).status,'accepted');
  assert.equal(b.receipt('one',{ bindingId:target.id,requestId:'r1',status:'unknown' }),null);
});
test('stop targets the pinned session and is not replayed', () => {
  const { b,target } = ready(); b.heartbeat('one','b'); b.stop({ bindingId:target.id,requestId:'s1' });
  assert.equal(b.take('one').command.action,'stop'); assert.equal(b.pending.sessionId,'a');
  assert.equal(b.stop({ bindingId:target.id,requestId:'s1' }),null);
});
test('authorization fails closed and request body remains bounded for text chunks', async () => {
  const req={socket:{remoteAddress:'127.0.0.1'}};
  assert.equal(authorize({get:()=>null},req),503);
  assert.equal(authorize({get:()=>({requestRejection:()=>401})},req),401);
  assert.equal(authorize({get:()=>({requestRejection:()=>undefined})},req),undefined);
  assert.equal(authorize({get:()=>null},{socket:{remoteAddress:'192.168.0.2'}}),403);
  assert.equal((await readBody(Readable.from([JSON.stringify({text:'字'.repeat(8000)})]))).text.length,8000);
  await assert.rejects(readBody(Readable.from(['x'.repeat(REQUEST_LIMIT+1)])));
});
