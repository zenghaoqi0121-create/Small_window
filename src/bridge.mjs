import { randomUUID } from 'node:crypto';
export const MAX_IMAGE = 8 * 1024 * 1024;
export class Bridge {
  constructor(now = Date.now) { this.now = now; this.active = null; this.opened = null; this.pending = null; }
  sync(clientId, sessionId) {
    if (typeof clientId !== 'string' || !/^[\w-]{1,80}$/.test(clientId) || typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw new Error('Invalid session');
    this.expire();
    this.active = { clientId, sessionId, seen: this.now() };
    return this.pending?.clientId === clientId && this.pending.sessionId === sessionId ? this.pending : null;
  }
  open() {
    this.expire();
    if (this.pending) throw new Error('上一份截图尚未接收，请回到原会话，或稍后重试。');
    if (this.opened) return this.opened;
    if (!this.active || this.now() - this.active.seen > 10000) throw new Error('请先在 Harness 中选中一个会话。');
    this.opened = { ...this.active, id: randomUUID(), created: this.now() };
    return this.opened;
  }
  accept(message) {
    this.expire();
    if (!this.opened || message.id !== this.opened.id) throw new Error('小窗目标已失效，请重新打开。');
    if (typeof message.question !== 'string' || !message.question.trim() || message.question.length > 12000) throw new Error('请填写问题（最多 12000 字）。');
    if (message.image !== null && message.image !== undefined) {
      if (typeof message.image !== 'string' || message.image.length > Math.ceil(MAX_IMAGE / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.image)) throw new Error('截图过大或格式无效。');
      const bytes = Buffer.from(message.image, 'base64');
      if (bytes.length > MAX_IMAGE || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('截图必须是 8MB 以内的 PNG。');
    }
    this.pending = { ...this.opened, question: message.question.trim(), image: message.image ?? null, created: this.now() };
    this.opened = null;
    return this.pending;
  }
  ack(clientId, id) {
    if (this.pending?.clientId !== clientId || this.pending.id !== id) return false;
    this.pending = null;
    return true;
  }
  cancel(id) { if (this.opened?.id === id) this.opened = null; }
  expire() {
    for (const key of ['opened', 'pending']) if (this[key] && this.now() - this[key].created >= 600000) this[key] = null;
  }
  clear() { this.pending = this.opened = this.active = null; }
}

export function authorize(ctx, request) {
  const address = request.socket?.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return 403;
  const connection = ctx.get('connection');
  if (typeof connection?.requestRejection !== 'function') return 503;
  return connection.requestRejection(request);
}

export async function readBody(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 4096) throw new Error('Request too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
