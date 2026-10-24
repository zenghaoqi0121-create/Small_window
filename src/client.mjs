import { deliver } from './deliver.mjs';

export function installClient(ctx, React) {
  const { createElement: h, useEffect, useRef, useState } = React;
  const conversation = ctx.get('conversation');
  const clientId = globalThis.crypto.randomUUID();
  const received = new Set();
  async function api(body) {
    const response = await fetch('/api/shichuang', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, clientId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '插件连接失败');
    return result;
  }
  function Entry({ targetSession, inputActions, useInput }) {
    const state = useInput(x => x);
    const live = useRef({ state, inputActions }); live.current = { state, inputActions };
    const [notice, setNotice] = useState('');
    useEffect(() => {
      let stopped = false; let timer;
      const poll = async () => {
        try {
          const result = await api({ action: 'sync', sessionId: targetSession });
          if (stopped) return;
          if (result.error) throw new Error(result.error);
          const item = result.item;
          if (item) {
            if (!received.has(item.id)) {
              deliver(item, { sessionId: targetSession, conversation, ...live.current, makeFile: image => {
                const bytes = Uint8Array.from(atob(image), c => c.charCodeAt(0));
                return new File([bytes], '拾窗截图.png', { type: 'image/png' });
              } });
              received.add(item.id);
            }
            const ack = await api({ action: 'ack', id: item.id });
            if (ack.ok) received.delete(item.id);
            if (!stopped) setNotice('已放入草稿，检查后发送');
          }
        } catch (error) { if (!stopped) setNotice(error.message); }
        finally { if (!stopped) timer = setTimeout(poll, 1000); }
      };
      poll();
      return () => { stopped = true; clearTimeout(timer); };
    }, [targetSession]);
    return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
      h('button', { type: 'button', title: notice || '打开拾窗 · Alt+Space', 'aria-label': '打开拾窗截图小窗', style: { border: '1px solid #94a3b8', borderRadius: 7, background: 'transparent', color: 'inherit', padding: '4px 9px', cursor: 'pointer' }, onClick: () => api({ action: 'open', sessionId: targetSession }).catch(e => setNotice(e.message)) }, '截图提问'),
      notice ? h('span', { role: 'status', style: { fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: notice }, notice) : null);
  }
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'shichuang', order: 90, inject: sessionId => ({ targetSession: sessionId }) }, Entry));
}
