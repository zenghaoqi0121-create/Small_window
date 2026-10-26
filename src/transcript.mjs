export function blocksText(blocks = []) {
  return blocks.map(b => b.type === 'text' ? b.text : b.type === 'image' ? '[图片]' : b.type === 'file' ? '[文件]' : '').filter(Boolean).join('\n');
}
export function projectTranscript(binding, title, connectionState = 'connected') {
  const rows = []; const live = new Map(); const finalSteps = new Set();
  const entries = binding.eventSource.getSnapshot().entries;
  let endReason = null;
  for (const { event } of entries) {
    const d = event.data;
    if (event.type === 'turn/end') endReason = d.reason;
    if (event.type === 'user/message' && (!d.source || d.source.kind === 'user')) {
      rows.push({ id: d.id || 'u-' + event.seq, role: 'user', text: blocksText(d.content) });
    } else if (event.type === 'assistant/message') {
      const key = d.turn + ':' + d.step; finalSteps.add(key);
      rows.push({ id: d.message.id || 'a-' + event.seq, role: 'assistant', text: blocksText(d.message.content), interrupted: !!d.interrupted });
    } else if (event.type === 'assistant/live-chunk') {
      const key = d.turn + ':' + d.step;
      let attempt = live.get(d.attemptId);
      if (!attempt) { attempt = { id: 'live-' + d.attemptId, key, role: 'assistant', blocks: new Map() }; live.set(d.attemptId, attempt); }
      const c = d.chunk;
      if (c.type === 'text-delta') attempt.blocks.set(c.index, (attempt.blocks.get(c.index) || '') + c.text);
      if (c.type === 'block-end' && c.block.type === 'text') attempt.blocks.set(c.index, c.block.text);
    }
  }
  for (const attempt of live.values()) {
    if (!finalSteps.has(attempt.key)) rows.push({ id: attempt.id, role: 'assistant', text: [...attempt.blocks].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join('\n') });
  }
  const state = binding.session.getSnapshot();
  const queue = binding.session.projections?.faceOf('inbox').getSnapshot()?.['next-turn'] ?? [];
  const ids = new Set(rows.map(row => row.id));
  const requestIds = new Set(entries.filter(({ event }) => event.type === 'user/message').map(({ event }) => event.data.source?.rpcId).filter(Boolean));
  for (const message of queue) {
    if (!ids.has(message.id)) { rows.push({ id: message.id, role: 'user', text: blocksText(message.content) }); ids.add(message.id); }
    if (message.source?.rpcId) requestIds.add(message.source.rpcId);
  }
  for (const pending of state.pendingSubmissions ?? []) {
    if (!requestIds.has(pending.requestId)) rows.push({ id: 'pending-' + pending.requestId, role: 'user', text: [pending.attachments?.length ? '[图片/附件]' : '', pending.text].filter(Boolean).join('\n') });
  }
  let status = 'complete'; let error = '';
  if (connectionState !== 'connected') { status = 'disconnected'; error = '连接中断，恢复后会继续同步；不会自动重发消息。'; }
  else if (state.removed) { status = 'unavailable'; error = '目标会话已删除，请从主窗口选择其他会话。'; }
  else if (state.openError) { status = 'unavailable'; error = '目标会话暂不可用。'; }
  else if (state.lastAgentError) { status = 'failed'; error = state.lastAgentError; }
  else if (queue.length) status = 'queued';
  else if (state.running) status = 'generating';
  else if (/cancel|abort|interrupt/i.test(String(endReason))) status = 'stopped';
  const messages = rows.filter(row => row.text).slice(-20);
  const text = messages.map(row => (row.role === 'user' ? '你' : '助手') + (row.interrupted ? '（已停止）' : '') + '\n' + row.text).join('\n\n────────────────\n\n');
  return { title, status, running: state.running, error, messages, text };
}
export function textFrames(text, size = 8000) {
  const frames = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + size, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    frames.push(text.slice(offset, end)); offset = end;
  }
  return frames.length ? frames : [''];
}
