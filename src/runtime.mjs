import { deliver } from './deliver.mjs';
import { projectTranscript, textFrames } from './transcript.mjs';
export class FloatingRuntime {
  constructor({ sessions, conversation, connection, api, makeFile, onNotice = () => {}, schedule = setTimeout, unschedule = clearTimeout }) {
    Object.assign(this, { sessions, conversation, connection, api, makeFile, onNotice, schedule, unschedule });
    this.active = null; this.target = null; this.reference = null; this.binding = null; this.ready = null;
    this.receipts = new Map(); this.started = new Set(); this.unsubscribers = [];
    this.pendingSnapshot = null; this.publishing = false; this.revision = Date.now(); this.lastProjection = '';
    this.stopped = false;
  }
  select(sessionId) {
    this.active = sessionId;
    return () => { if (this.active === sessionId) this.active = null; };
  }
  title(sessionId) { return this.sessions.list.getSnapshot().byId[sessionId]?.displayTitle || sessionId; }
  start() {
    this.unsubscribeConnection = this.connection.state.subscribe(() => this.changed());
    this.unsubscribeGeneration = this.connection.generation.subscribe(() => {
      if (this.target && this.connection.generation.getSnapshot()) this.attach(this.target, true);
    });
    this.poll();
  }
  async open(sessionId) {
    return this.api({ action: 'open', sessionId, title: this.title(sessionId) });
  }
  async poll() {
    if (this.stopped) return;
    try {
      const result = await this.api({ action: 'sync', sessionId: this.active, title: this.active ? this.title(this.active) : '', receipts: [...this.receipts.values()] });
      if (this.stopped) return;
      for (const id of result.ack ?? []) this.receipts.delete(id);
      if (result.error) throw new Error(result.error);
      if (result.target) this.attach(result.target);
      else if (this.target) this.detach();
      if (result.command && !this.started.has(result.command.requestId)) {
        this.started.add(result.command.requestId);
        if (this.started.size > 200) this.started.delete(this.started.values().next().value);
        this.execute(result.command);
      }
      if (this.pendingSnapshot && !this.publishing) this.publish();
    } catch (error) { if (!this.stopped) this.onNotice(error.message); }
    finally { if (!this.stopped) this.pollTimer = this.schedule(() => this.poll(), 400); }
  }
  attach(target, force = false) {
    if (!force && this.target?.id === target.id) return;
    this.detach(); this.target = target; this.lastProjection = '';
    const token = {};
    this.bindingToken = token;
    try {
      const ref = this.sessions.retain(target.sessionId, { source: 'shichuang' });
      this.reference = ref;
      this.ready = ref.ready.then(binding => {
        if (this.stopped || this.bindingToken !== token) return null;
        this.binding = binding;
        const update = () => this.changed();
        this.unsubscribers = [binding.eventSource.subscribe(update), binding.session.subscribe(update), binding.session.projections.faceOf('inbox').subscribe(update)];
        this.changed(); return binding;
      }).catch(() => {
        if (!this.stopped && this.bindingToken === token) {
          this.queueSnapshot({ title: target.title, status: 'unavailable', error: '目标会话无法打开，请在主窗口检查。', running: false, text: '' });
        }
        return null;
      });
    } catch {
      this.ready = Promise.resolve(null);
      this.queueSnapshot({ title: target.title, status: 'unavailable', error: '目标会话暂不可用。', running: false, text: '' });
    }
  }
  detach() {
    this.bindingToken = null;
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.reference?.release(); this.reference = null; this.binding = null; this.target = null;
    this.pendingSnapshot = null; this.lastProjection = '';
  }
  changed() {
    if (this.stopped || !this.binding || !this.target) return;
    this.queueSnapshot(projectTranscript(this.binding, this.title(this.target.sessionId), this.connection.state.getSnapshot()));
  }
  queueSnapshot(snapshot) {
    if (!this.target || this.stopped) return;
    const signature = JSON.stringify(snapshot);
    if (signature === this.lastProjection) return;
    this.lastProjection = signature;
    this.pendingSnapshot = { ...snapshot, bindingId: this.target.id, revision: ++this.revision };
    if (!this.publishTimer) this.publishTimer = this.schedule(() => { this.publishTimer = null; this.publish(); }, 100);
  }
  async publish() {
    if (this.publishing || this.stopped) return;
    this.publishing = true;
    try {
      while (this.pendingSnapshot && !this.stopped) {
        const snapshot = this.pendingSnapshot; this.pendingSnapshot = null;
        const frames = textFrames(snapshot.text);
        try {
          for (let index = 0; index < frames.length; index++) {
            if (this.stopped || this.target?.id !== snapshot.bindingId) break;
            await this.api({ action: 'update', bindingId: snapshot.bindingId, revision: snapshot.revision, index, total: frames.length, text: frames[index], title: snapshot.title, status: snapshot.status, running: snapshot.running, error: snapshot.error });
          }
        } catch {
          if (this.target?.id === snapshot.bindingId && !this.pendingSnapshot) this.pendingSnapshot = snapshot;
          break;
        }
      }
    } finally { this.publishing = false; }
  }
  async execute(command) {
    let result;
    try {
      const targetId = command.bindingId;
      const binding = await this.ready;
      if (this.stopped) return;
      if (!binding || this.target?.id !== targetId) result = { status: 'failed', error: '目标会话已失效，消息没有发送。' };
      else if (command.action === 'stop') {
        if (binding.session.getSnapshot().removed) result = { status: 'failed', error: '目标会话已删除。' };
        else {
          const response = await binding.session.cancel();
          result = response.ok ? { status: 'stopped' } : { status: 'failed', error: '停止生成失败。' };
        }
      } else {
        result = await deliver(command, { binding, conversation: this.conversation, makeFile: this.makeFile });
      }
    } catch { result = { status: 'unknown', error: '操作结果未确认，请核对原会话。不会自动重发。' }; }
    if (!this.stopped) {
      this.receipts.set(command.requestId, { bindingId: command.bindingId, requestId: command.requestId, ...result });
      this.changed();
    }
  }
  dispose() {
    this.stopped = true; this.unschedule(this.pollTimer); this.unschedule(this.publishTimer);
    this.unsubscribeConnection?.(); this.unsubscribeGeneration?.(); this.detach(); this.receipts.clear();
  }
}
