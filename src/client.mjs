import { FloatingRuntime } from './runtime.mjs';
export function installClient(ctx, React) {
  const { createElement: h, useEffect, useState } = React;
  let clientId = globalThis.crypto.randomUUID();
  try {
    clientId = sessionStorage.getItem('shichuang-client-id') || clientId;
    sessionStorage.setItem('shichuang-client-id', clientId);
  } catch {}
  async function api(body) {
    const response = await fetch('/api/shichuang', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, clientId }), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '插件连接失败');
    return result;
  }
  const listeners = new Set(); let notice = '';
  const runtime = new FloatingRuntime({
    sessions: ctx.get('sessions'), conversation: ctx.get('conversation'), connection: ctx.get('connection'), api,
    makeFile: image => new File([Uint8Array.from(atob(image), c => c.charCodeAt(0))], '拾窗截图.png', { type: 'image/png' }),
    onNotice: text => { notice = text; for (const listener of listeners) listener(text); }
  });
  ctx.effect(() => { runtime.start(); return () => runtime.dispose(); });
  function Entry({ targetSession }) {
    const [message, setMessage] = useState(notice);
    useEffect(() => runtime.select(targetSession), [targetSession]);
    useEffect(() => { listeners.add(setMessage); return () => listeners.delete(setMessage); }, []);
    return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
      h('button', { type: 'button', title: message || '打开拾窗 · Alt+Space', 'aria-label': '打开拾窗对话浮窗', style: { border: '1px solid #94a3b8', borderRadius: 7, background: 'transparent', color: 'inherit', padding: '4px 9px', cursor: 'pointer' }, onClick: () => runtime.open(targetSession).catch(e => setMessage(e.message)) }, '截图提问'),
      message ? h('span', { role: 'status', title: message, style: { fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, message) : null);
  }
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'shichuang', order: 90, inject: sessionId => ({ targetSession: sessionId }) }, Entry));
}
