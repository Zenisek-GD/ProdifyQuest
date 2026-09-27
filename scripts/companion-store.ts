import type { CompanionResponse } from './companion-types';

export type CompanionUpdate = Omit<CompanionResponse, 'focus'> & {
  focus?: CompanionResponse['focus']; awarded?: boolean; greeting?: string;
};
export type CompanionSnapshot = {
  data: CompanionResponse | null; loading: boolean; error: string; focusReceivedAt: number;
};
type Response = { data: CompanionUpdate };
type Options = {
  read: () => Promise<Response>;
  write: (path: string, body?: object, method?: 'POST' | 'PATCH' | 'PUT') => Promise<Response>;
  isCurrent: () => boolean; message: (error: unknown) => string; now?: () => number;
};

export function focusRemaining(snapshot: CompanionSnapshot, now: number) {
  const focus = snapshot.data?.focus;
  if (!focus || !['running', 'paused'].includes(focus.status)) return 0;
  const elapsed = focus.status === 'running' ? Math.max(0, now - snapshot.focusReceivedAt) / 1000 : 0;
  return Math.max(0, Math.ceil(focus.remainingSeconds - elapsed));
}

/** One confirmed snapshot for every screen. Reads started before a mutation
 * cannot replace its result, and omitted focus fields never restart its clock. */
export function createCompanionStore({ read, write, isCurrent, message, now = Date.now }: Options) {
  let snapshot: CompanionSnapshot = { data: null, loading: true, error: '', focusReceivedAt: 0 };
  let revision = 0;
  let lifecycle = 0;
  let active = true;
  let writing = false;
  let pendingRead: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: CompanionSnapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  const valid = (version: number) => active && isCurrent() && revision === version;
  function accept(update: CompanionUpdate) {
    const hasFocus = Object.prototype.hasOwnProperty.call(update, 'focus');
    const activeId = update.companion.activeFocusId;
    const mismatchedFocus = hasFocus && !!activeId && activeId !== update.focus?.id;
    const replaceFocus = hasFocus && !mismatchedFocus;
    const focus = mismatchedFocus ? snapshot.data?.focus?.id === activeId ? snapshot.data.focus : null
      : replaceFocus ? update.focus ?? null : snapshot.data?.focus ?? null;
    publish({
      data: { ...snapshot.data, ...update, focus }, loading: false, error: '',
      focusReceivedAt: replaceFocus ? now() : snapshot.focusReceivedAt,
    });
    return mismatchedFocus;
  }
  function reload(): Promise<void> {
    if (!active || !isCurrent() || writing) return Promise.resolve();
    if (pendingRead) return pendingRead;
    const version = ++revision;
    const request = (async () => {
      try { const response = await read(); if (valid(version)) accept(response.data); }
      catch (error) { if (valid(version)) publish({ ...snapshot, loading: false, error: message(error) }); }
    })();
    pendingRead = request;
    void request.finally(() => { if (pendingRead === request) pendingRead = null; });
    return request;
  }
  function refresh() {
    revision += 1;
    pendingRead = null;
    // A mutation's response will be the next authoritative snapshot.
    if (writing) return Promise.resolve();
    return reload();
  }
  async function mutate(path: string, body?: object, method: 'POST' | 'PATCH' | 'PUT' = 'POST') {
    if (writing) throw new Error('Please wait for your companion to finish updating.');
    if (!active || !isCurrent()) throw new Error('The session changed. Please try again.');
    writing = true;
    const startedIn = lifecycle;
    let needsRefresh = false;
    const version = ++revision;
    pendingRead = null;
    try {
      const response = await write(path, body, method);
      if (!active || !isCurrent() || lifecycle !== startedIn) throw new Error('The session changed. Please try again.');
      if (active && isCurrent()) {
        // Route/profile refreshes may happen during a write; they must not discard it.
        revision = Math.max(revision, version) + 1;
        needsRefresh = accept(response.data);
      }
      return response;
    } catch (error) {
      // A timeout may have happened after the server saved the action.
      // Preserve the last confirmation until reconciliation succeeds.
      writing = false;
      if (active && isCurrent() && lifecycle === startedIn) void refresh();
      throw error;
    } finally { writing = false; if (needsRefresh) void refresh(); }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload, refresh, mutate,
    start() { active = true; },
    stop() { active = false; lifecycle += 1; revision += 1; pendingRead = null; },
  };
}
