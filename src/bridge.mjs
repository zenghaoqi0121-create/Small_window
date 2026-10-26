import { randomUUID } from 'node:crypto';
export const MAX_IMAGE = 8 * 1024 * 1024;
export const REQUEST_LIMIT = 64 * 1024;
const validId = value => typeof value === 'string' && /^[\w-]{1,200}$/.test(value);
export class Bridge {
  constructor(now = Date.now) {
    this.now = now; this.active = null; this.target = null; this.pending = null;
    this.dirty = false; this.commands = new Map(); this.lastSeen = 0;
  }
  heartbeat(clientId, sessionId, title = '') {
    if (!validId(clientId)) throw new Error('Invalid client');
    if (this.target?.clientId === clientId) this.lastSeen = this.now();
    if (sessionId == null) return;
    if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 200 || typeof title !== 'string' || title.length > 300) throw new Error('Invalid session');
    this.active = { clientId, sessionId, title: title || sessionId, seen: this.now() };
  }
  open(selection) {
    const context = selection ?? this.target ?? this.active;
    if (!context || (!this.target && this.now() - context.seen > 10000)) throw new Error('请先在 Harness 中选中一个会话。');
    if (this.target?.clientId === context.clientId && this.target.sessionId === context.sessionId) return this.target;
    if (this.pending || this.dirty) throw new Error('请先发送或清空浮窗内容，再切换目标会话。');
    this.target = { id: randomUUID(), clientId: context.clientId, sessionId: context.sessionId, title: context.title };
    this.lastSeen = this.now();
    return this.target;
  }
  submit(message) {
    if (!this.target || message.bindingId !== this.target.id) throw new Error('目标会话已失效，请重新打开。');
    if (!validId(message.requestId)) throw new Error('Invalid request id');
    if (this.commands.has(message.requestId)) return null;
    if (this.pending) throw new Error('上一条消息还在发送，请稍等。');
    if (typeof message.question !== 'string' || message.question.length > 12000) throw new Error('问题最多 12000 字。');
    const image = message.image ?? null;
    if (image !== null) {
      if (typeof image !== 'string' || image.length > Math.ceil(MAX_IMAGE / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image)) throw new Error('截图过大或格式无效。');
      const bytes = Buffer.from(image, 'base64');
      if (bytes.length > MAX_IMAGE || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('截图必须是 8MB 以内的 PNG。');
    }
    if (!message.question.trim() && !image) throw new Error('请先截图或输入消息。');
    return this.addCommand({ action: 'send', question: message.question.trim() ? message.question : '请分析这张截图。', image, requestId: message.requestId });
  }
  stop(message) {
    if (!this.target || message.bindingId !== this.target.id || !validId(message.requestId)) throw new Error('目标会话已失效。');
    if (this.commands.has(message.requestId)) return null;
    if (this.pending) throw new Error('发送尚未确认，请稍后停止生成。');
    return this.addCommand({ action: 'stop', requestId: message.requestId });
  }
  addCommand(fields) {
    const command = { ...fields, bindingId: this.target.id, sessionId: this.target.sessionId, clientId: this.target.clientId, issued: false, created: this.now() };
    this.pending = command; this.commands.set(command.requestId, command);
    if (this.commands.size > 100) this.commands.delete(this.commands.keys().next().value);
    return command;
  }
  take(clientId) {
    if (this.target?.clientId !== clientId) return { target: null, command: null };
    let command = null;
    if (this.pending && !this.pending.issued) { this.pending.issued = true; command = { ...this.pending }; }
    return { target: this.target, command };
  }
  receipt(clientId, receipt) {
    const command = this.commands.get(receipt.requestId);
    if (!command || command.clientId !== clientId || command.bindingId !== receipt.bindingId) return null;
    if (!['accepted', 'failed', 'unknown', 'stopped'].includes(receipt.status)) throw new Error('Invalid receipt');
    if (command.status === receipt.status || ['accepted', 'failed', 'stopped'].includes(command.status)) return null;
    command.status = receipt.status; command.image = null; command.question = '';
    if (this.pending === command) this.pending = null;
    return { type: 'receipt', bindingId: command.bindingId, requestId: command.requestId, action: command.action, status: receipt.status, error: String(receipt.error ?? '').slice(0, 500) };
  }
  timeout() {
    if (!this.pending || this.now() - this.pending.created < 30000) return null;
    return this.receipt(this.pending.clientId, { ...this.pending, status: 'unknown', error: '未能确认是否发送，请核对原会话。不会自动重发。' });
  }
  owns(clientId, bindingId) { return this.target?.clientId === clientId && this.target.id === bindingId; }
  clear() { this.active = this.target = this.pending = null; this.commands.clear(); }
}
export function authorize(ctx, request) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress)) return 403;
  const connection = ctx.get('connection');
  if (typeof connection?.requestRejection !== 'function') return 503;
  return connection.requestRejection(request);
}
export async function readBody(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > REQUEST_LIMIT) throw new Error('Request too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
