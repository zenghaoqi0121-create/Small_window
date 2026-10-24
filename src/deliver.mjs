// Runs synchronously: no await between editor guards and draft mutation.
export function deliver(item, { sessionId, conversation, inputActions, state, makeFile }) {
  if (item.sessionId !== sessionId) throw new Error('会话已切换，请回到截图的目标会话。');
  if (state.phase !== 'plain') throw new Error('当前输入框忙碌，请稍后重试。');
  const span = inputActions.captureInsertion();
  const drafts = item.image ? conversation.createDrafts(sessionId, [makeFile(item.image)]) : [];
  const ids = drafts.map(d => d.id);
  if (ids.length && !inputActions.addAttachments(ids)) {
    conversation.releaseDraftAttachments(drafts);
    throw new Error('输入框暂时无法接收截图。');
  }
  const text = `${state.draft ? '\n' : ''}${item.question}`;
  try {
    if (!inputActions.insertText(text, span)) throw new Error('草稿发生变化，请重新接收。');
  } catch (error) {
    ids.forEach(id => inputActions.removeAttachment(id));
    conversation.releaseDraftAttachments(drafts);
    throw error;
  }
}
