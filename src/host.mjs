import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { Bridge, authorize, readBody } from './bridge.mjs';
export const inject = ['webServer', 'skills'];
export function apply(ctx) {
  if (process.platform !== 'win32') { ctx.logger.warn('拾窗仅支持 Windows。'); return; }
  const skill = readFileSync(new URL('../skills/screen-question/SKILL.md', import.meta.url), 'utf8');
  ctx.skills.register({ name: 'screen-question', description: '结合截图回答界面、报错和图片文字问题。', source: 'bundled', content: skill.replace(/^---[\s\S]*?---\s*/, '') });
  ctx.effect(() => attachHost(ctx));
}
export function attachHost(ctx, launch = spawn) {
  const bridge = new Bridge();
  let child; let lines; let failed = null; let disposed = false; let disconnected = false;
  function send(message) { if (child?.stdin.writable) child.stdin.write(JSON.stringify(message) + '\n'); }
  function open(selection) {
    if (failed) throw new Error(failed);
    const target = bridge.open(selection);
    send({ type: 'show', bindingId: target.id, sessionId: target.sessionId, title: target.title });
  }
  try {
    child = launch(fileURLToPath(new URL('../native/Shichuang.exe', import.meta.url)), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.on('error', () => { failed = '小窗组件启动失败，请重新构建或重启插件。'; ctx.logger.warn(failed); });
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {});
    child.on('exit', () => { if (!disposed) failed = '小窗组件已退出，请重启插件。'; bridge.clear(); });
    lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (line.length > 12 * 1024 * 1024) return;
      let message;
      try {
        message = JSON.parse(line);
        if (message.type === 'open') open();
        else if (message.type === 'dirty' && bridge.target?.id === message.bindingId) bridge.dirty = !!message.dirty;
        else if (message.type === 'submit' || message.type === 'stop') {
          const command = message.type === 'submit' ? bridge.submit(message) : bridge.stop(message);
          if (command) send({ type: 'sending', bindingId: command.bindingId, requestId: command.requestId, action: command.action });
        }
      } catch (error) {
        send({ type: 'error', text: error.message, requestId: message?.requestId, retry: ['submit', 'stop'].includes(message?.type) });
      }
    });
  } catch { failed = '小窗组件不可用。'; }
  const timer = setInterval(() => {
    const timeout = bridge.timeout(); if (timeout) send(timeout);
    if (bridge.target && bridge.now() - bridge.lastSeen > 6000 && !disconnected) {
      disconnected = true; send({ type: 'connection', connected: false });
    }
  }, 1000);
  timer.unref();
  const disposeRoute = ctx.webServer.register({
    kind: 'exact', path: '/api/shichuang',
    handler: async (request, response) => {
      const reply = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
      try {
        const rejection = authorize(ctx, request);
        if (rejection !== undefined) return reply(rejection, { error: 'Harness 本地认证失败。' });
        if (request.method !== 'POST') return reply(405, { error: 'POST required' });
        const body = await readBody(request);
        if (body.action === 'sync') {
          bridge.heartbeat(body.clientId, body.sessionId, body.title);
          const receipts = body.receipts ?? [];
          if (!Array.isArray(receipts) || receipts.length > 100) throw new Error('Invalid receipts');
          for (const receipt of receipts) { const event = bridge.receipt(body.clientId, receipt); if (event) send(event); }
          if (disconnected && bridge.target?.clientId === body.clientId) { disconnected = false; send({ type: 'connection', connected: true }); }
          return reply(200, { ...bridge.take(body.clientId), ack: receipts.map(r => r.requestId), error: failed });
        }
        if (body.action === 'open') {
          bridge.heartbeat(body.clientId, body.sessionId, body.title);
          if (bridge.active?.clientId !== body.clientId || bridge.active.sessionId !== body.sessionId) throw new Error('请先选择目标会话。');
          open(bridge.active); return reply(200, { ok: true });
        }
        if (body.action === 'update') {
          if (!bridge.owns(body.clientId, body.bindingId)) return reply(409, { error: '目标会话已切换。' });
          if (!Number.isSafeInteger(body.revision) || !Number.isInteger(body.index) || !Number.isInteger(body.total) || body.index < 0 || body.index >= body.total || body.total > 2048 || typeof body.text !== 'string' || body.text.length > 8000) throw new Error('Invalid update frame');
          const statuses = ['complete','generating','queued','stopped','failed','disconnected','unavailable'];
          if (!statuses.includes(body.status)) throw new Error('Invalid state');
          send({ type: 'transcript', bindingId: body.bindingId, revision: body.revision, index: body.index, total: body.total, text: body.text, title: String(body.title ?? '').slice(0, 300), status: body.status, running: !!body.running, error: String(body.error ?? '').slice(0, 500) });
          return reply(200, { ok: true });
        }
        return reply(400, { error: 'Unknown action' });
      } catch (error) { return reply(400, { error: error.message }); }
    }
  });
  return () => {
    disposed = true; clearInterval(timer); disposeRoute(); bridge.clear(); lines?.close();
    send({ type: 'quit' });
    const killTimer = setTimeout(() => child?.kill(), 1000); killTimer.unref();
    child?.once('exit', () => clearTimeout(killTimer));
  };
}
