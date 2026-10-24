import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { Bridge, authorize, readBody } from './bridge.mjs';

export const inject = ['webServer', 'skills'];
export function apply(ctx) {
  if (process.platform !== 'win32') { ctx.logger.warn('拾窗 MVP 仅支持 Windows。'); return; }
  const skill = readFileSync(new URL('../skills/screen-question/SKILL.md', import.meta.url), 'utf8');
  ctx.skills.register({ name: 'screen-question', description: '结合截图回答界面、报错和图片文字问题。', source: 'bundled', content: skill.replace(/^---[\s\S]*?---\s*/, '') });
  ctx.effect(() => attachHost(ctx));
}

export function attachHost(ctx, launch = spawn) {
    const bridge = new Bridge();
    let child = null; let lines = null; let failed = null;
    function send(message) { if (child?.stdin.writable) child.stdin.write(JSON.stringify(message) + '\n'); }
    function open() {
      if (failed) throw new Error(failed);
      const target = bridge.open();
      send({ type: 'show', id: target.id, sessionId: target.sessionId });
    }
    try {
      child = launch(fileURLToPath(new URL('../native/Shichuang.exe', import.meta.url)), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      child.on('error', () => { failed = '小窗组件启动失败，请重新构建或重启插件。'; ctx.logger.warn(failed); });
      child.stdin.on('error', () => {});
      child.stderr.on('data', () => {});
      child.on('exit', () => { failed = '小窗组件已退出，请重启插件。'; bridge.clear(); });
      lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        if (line.length > 12 * 1024 * 1024) return;
        let message;
        try {
          message = JSON.parse(line);
          if (message.type === 'open') open();
          else if (message.type === 'cancel') bridge.cancel(message.id);
          else if (message.type === 'submit') {
            bridge.accept(message);
            send({ type: 'queued', id: message.id, text: '等待目标会话接收，请保持 Harness 运行。' });
          }
        } catch (error) { send({ type: 'error', text: error.message, retry: message?.type === 'submit' }); }
      });
    } catch { failed = '小窗组件不可用。'; }
    const disposeRoute = ctx.webServer.register({
      kind: 'exact', path: '/api/shichuang',
      handler: async (request, response) => {
        const reply = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
        try {
          const rejection = authorize(ctx, request);
          if (rejection !== undefined) return reply(rejection, { error: 'Harness 本地认证失败。' });
          if (request.method !== 'POST') return reply(405, { error: 'POST required' });
          const body = await readBody(request);
          if (body.action === 'sync') return reply(200, { item: bridge.sync(body.clientId, body.sessionId), error: failed });
          if (body.action === 'open') {
            bridge.sync(body.clientId, body.sessionId); open();
            return reply(200, { ok: true });
          }
          if (body.action === 'ack') {
            const ok = bridge.ack(body.clientId, body.id);
            if (ok) send({ type: 'delivered', id: body.id, text: '已放入会话草稿，请在 Harness 检查后发送。' });
            return reply(200, { ok });
          }
          if (body.action === 'notice') { send({ type: 'error', text: '请回到目标会话完成接收。' }); return reply(200, { ok: true }); }
          return reply(400, { error: 'Unknown action' });
        } catch (error) { return reply(400, { error: error.message }); }
      }
    });
    return () => {
      disposeRoute(); bridge.clear(); lines?.close();
      send({ type: 'quit' });
      const ownedChild = child;
      const timer = setTimeout(() => ownedChild?.kill(), 1000); timer.unref();
      ownedChild?.once('exit', () => clearTimeout(timer));
    };
}
