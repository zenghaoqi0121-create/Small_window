import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliver } from '../src/deliver.mjs';
function fixture(overrides = {}) {
  const calls = [];
  const env = { sessionId: 'a', state: { phase: 'plain', draft: '旧草稿' }, makeFile: () => 'file',
    conversation: { createDrafts: () => [{ id: 'img' }], releaseDraftAttachments: () => calls.push('release') },
    inputActions: { captureInsertion: () => 'span', addAttachments: () => { calls.push('attach'); return true; }, removeAttachment: () => calls.push('remove'), insertText: (text, span) => { calls.push([text, span]); return true; } }, ...overrides };
  return { env, calls };
}
const item = { sessionId: 'a', question: '问题', image: 'image' };
test('keeps existing draft and uses guarded insertion', () => {
  const { env, calls } = fixture(); deliver(item, env);
  assert.deepEqual(calls, ['attach', ['\n问题', 'span']]);
});
test('does not mutate wrong or busy session', () => {
  const { env, calls } = fixture(); assert.throws(() => deliver({ ...item, sessionId: 'b' }, env));
  env.state.phase = 'submitting'; assert.throws(() => deliver(item, env)); assert.deepEqual(calls, []);
});
test('rolls back attachment when revision changes', () => {
  const { env, calls } = fixture(); env.inputActions.insertText = () => false;
  assert.throws(() => deliver(item, env)); assert.deepEqual(calls, ['attach', 'remove', 'release']);
});
test('releases unaccepted draft attachments', () => {
  const { env, calls } = fixture(); env.inputActions.addAttachments = () => false;
  assert.throws(() => deliver(item, env)); assert.deepEqual(calls, ['release']);
});
