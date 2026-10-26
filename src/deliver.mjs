// Never reads or writes the main composer's inputActions or draft ids.
export async function deliver(item, { binding, conversation, makeFile }) {
  if (item.sessionId !== binding.session.sessionId) throw new Error('目标会话不匹配。');
  if (binding.session.getSnapshot().removed) return { status: 'failed', error: '目标会话已删除。' };
  let drafts;
  try { drafts = item.image ? conversation.createDrafts(item.sessionId, [makeFile(item.image)]) : []; }
  catch { return { status: 'failed', error: '截图准备失败，请重新截图。' }; }
  try {
    const outcome = await conversation.sendSession(binding.session, item.question, drafts.map(d => d.id), 'queue');
    if (outcome.kind !== 'success') {
      conversation.releaseDraftAttachments(drafts);
      return { status: 'failed', error: 'Harness 未接收消息，请检查模型和图片支持。' };
    }
    return { status: 'accepted' };
  } catch {
    conversation.releaseDraftAttachments(drafts);
    return { status: 'unknown', error: '未能确认发送结果，请核对原会话。不会自动重发。' };
  }
}
