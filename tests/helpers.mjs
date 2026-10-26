export function observable(value) {
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, set(next) { value = next; for (const fn of [...listeners]) fn(); }, count: () => listeners.size };
}
export function bindingFixture(sessionId = 'a') {
  const state = observable({ removed: false, running: false, openState: 'open', openError: null, lastAgentError: null, pendingSubmissions: [] });
  const inbox = observable({ 'next-turn': [] });
  const events = observable({ entries: [] });
  const session = { ...state, sessionId, projections: { faceOf: () => inbox }, cancel: async () => ({ ok: true }) };
  return { binding: { sessionId, session, eventSource: events }, state, inbox, events };
}
export const event = (type, data, seq = 0) => ({ type: 'event', event: { type, data, seq } });
export const user = (id, text) => ({ id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] });
