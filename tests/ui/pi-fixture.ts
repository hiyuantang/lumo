// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from '@playwright/test';
import type { DesktopRequest, PiExtensionSettings } from '../../src/api/lumo-use';
import type { PiImageSettings, PiTemplate, PiRetry, PiSessionMetrics, PiPermissionMode, PiQuestion, PiAnswer, PiAuthState, PiCommand, PiEvent, PiMessage } from '../../src/api/pi';
export async function piFixture(page: Page) {
  let extensionSettings: PiExtensionSettings = { lumoUse: true, questions: true, calendar: true, revision: 'initial', extensions: [] };
  const desktop: DesktopRequest[] = [];
  const desktopResults: { desktopId: string; text: string; error: boolean }[] = [];
  const desktopClaims = new Set<string>();
  let retry: PiRetry | null = null;
  let closed = false;
  const templates = new Map<string, PiTemplate>();
  let imageSettings: PiImageSettings = { mode: 'original', revision: 'initial' };
  let permissionMode: PiPermissionMode = 'ask'; const sessionModes = new Map<string, PiPermissionMode>();
  let model = 'balanced'; let level = 'medium'; let session = 'first.jsonl'; let name = 'Project notes'; let busy = false;
  let desiredCompaction = { enabled: true, threshold: 160000 };
  let activeCompaction = { ...desiredCompaction };
  const events: PiEvent[] = []; const commands: PiCommand[] = []; const starts: { project: string; session: string; permissionMode?: PiPermissionMode; rememberPermissionMode?: boolean }[] = [];
  const messages: PiMessage[] = [];
  const metrics = new Map<string, PiSessionMetrics>();
  const queue: { type: string; message: string }[] = [];
  const questions: PiQuestion[] = []; const answers: PiAnswer[] = [];
  let emptyQueueReplies = false;
  const originals = new Map<string, PiMessage[]>();
  let forks = 0;
  let auth: PiAuthState | null = null;
  let credential = false;
  let authOperation = 'login';
  let authMethod = 'api_key';
  const models = [{ id: 'balanced', provider: 'Fixture', name: 'Balanced', reasoning: true, contextWindow: 200000 }, { id: 'fast', provider: 'Fixture', name: 'Fast', reasoning: false, contextWindow: 128000 }];
  const instructions = new Map<string, { content: string; revision: string }>();
  await page.route('**/api/v1/pi/**', async (route) => {
    const url = new URL(route.request().url()); const path = url.pathname;
    const reply = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (path.endsWith('/extensions')) {
      if (route.request().method() === 'POST') {
        const value = route.request().postDataJSON();
        if (value.revision !== extensionSettings.revision) return route.fulfill({ status: 409, json: { ok: false, error: { code: 'conflict', message: 'Pi settings changed on the server. Reload before saving.' } } });
        extensionSettings = { lumoUse: value.lumoUse, calendar: value.calendar ?? extensionSettings.calendar, questions: value.questions ?? extensionSettings.questions, revision: crypto.randomUUID(), extensions: extensionSettings.extensions?.map((item) => ({ ...item, enabled: value.extensions?.find((choice: { id: string }) => choice.id === item.id)?.enabled ?? item.enabled })) };
        if (!value.lumoUse) desktop.length = 0;
      }
      return reply(extensionSettings);
    }
    if (path.endsWith('/desktop/claim')) {
      const value = route.request().postDataJSON(); const request = desktop.find((item) => item.id === value.desktopId);
      if (!request || desktopClaims.has(request.id)) return route.fulfill({ status: 409, json: { ok: false, error: { code: 'conflict', message: 'Request already claimed.' } } });
      desktopClaims.add(request.id); return reply(request);
    }
    if (path.endsWith('/desktop/result')) {
      const value = route.request().postDataJSON(); desktopResults.push(value);
      const index = desktop.findIndex((item) => item.id === value.desktopId); if (index >= 0) desktop.splice(index, 1);
      return reply({ accepted: true });
    }
    if (path.endsWith('/image-settings')) {
      if (route.request().method() === 'POST') {
        const value = route.request().postDataJSON();
        if (value.revision !== imageSettings.revision) return route.fulfill({ status: 409, json: { ok: false, error: { code: 'conflict', message: 'Pi settings changed on the server. Reload before saving.' } } });
        imageSettings = { mode: value.mode, revision: crypto.randomUUID() };
      }
      return reply(imageSettings);
    }
    if (path.endsWith('/templates')) {
      if (route.request().method() === 'POST') { const item = route.request().postDataJSON(); if (item.delete) templates.delete(item.name); else templates.set(item.name, { ...item, revision: crypto.randomUUID(), path: `/home/user/.pi/agent/prompts/${item.name}.md` }); }
      return reply({ templates: [...templates.values()] });
    }
    if (path.endsWith('/connections')) return reply({ providers: credential ? [{ id: 'fixture', name: 'Fixture', credential: authMethod, keyPreview: authMethod === 'api_key' ? '••••1234' : undefined }] : [] });
    if (path.endsWith('/providers')) return reply({ providers: [{ id: 'fixture', name: 'Fixture', methods: [{ type: 'oauth', label: 'Sign in with browser' }, { type: 'api_key', label: 'API key' }], credential: credential ? authMethod : undefined }] });
    if (path.endsWith('/auth/start')) {
      const body = route.request().postDataJSON(); authOperation = body.operation; authMethod = body.method;
      if (authOperation === 'logout') credential = false;
      auth = { id: crypto.randomUUID(), status: authOperation === 'logout' ? 'done' : 'working', events: body.method === 'oauth' ? [{ type: 'auth_url', url: 'https://login.example.test/authorize', message: 'Sign in, then paste the redirect URL below.' }, { type: 'device_code', code: 'DEMO-CODE' }] : [], prompt: authOperation === 'logout' ? undefined : { id: 'first', type: body.method === 'oauth' ? 'manual_code' : 'secret', message: body.method === 'oauth' ? 'Redirect URL' : 'API key' } };
      return reply(auth);
    }
    if (path.endsWith('/auth')) return reply(auth);
    if (path.endsWith('/auth/reply')) { if (auth) { auth.status = 'done'; auth.prompt = undefined; credential = true; } return reply({}); }
    if (path.endsWith('/auth/cancel')) { if (auth) { auth.status = 'cancelled'; auth.prompt = undefined; } return reply({}); }
    if (path.endsWith('/settings')) {
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
      const kind = body?.kind ?? url.searchParams.get('kind');
      if (body) instructions.set(kind, { content: body.content, revision: crypto.randomUUID() });
      const value = instructions.get(kind);
      return reply({ kind, path: '/home/user/.pi/agent/' + (kind === 'instructions' ? 'AGENTS.md' : 'APPEND_SYSTEM.md'), content: value?.content ?? '', revision: value?.revision ?? '', exists: Boolean(value) });
    }
    if (path.endsWith('/reference')) return reply({ project: url.searchParams.get('project'), session: url.searchParams.get('session'), path: '/home/user/.local/state/lumo/pi-sessions/fixture/' + url.searchParams.get('session'), reader: '/usr/local/bin/lumod' });
    if (path.endsWith('/sessions')) return reply({ sessions: [...originals.keys()].map((id) => ({ id, name: 'Original chat', modified: '2026-09-28T11:00:00Z' })).concat([{ id: session, name, modified: '2026-09-28T12:00:00Z' }, { id: 'second.jsonl', name: 'Earlier work', modified: '2026-09-27T12:00:00Z' }]) });
    if (path.endsWith('/start')) { activeCompaction = { ...desiredCompaction }; const body = route.request().postDataJSON(); starts.push(body); if (!body.session && !body.resume && starts.length > 1) messages.length = 0; session = body.session || (body.resume ? session : 'first.jsonl'); if (!body.resume) events.length = 0; const selectedMode = body.permissionMode ?? (body.session ? sessionModes.get(body.session) : undefined) ?? permissionMode; sessionModes.set(session, selectedMode); if (body.rememberPermissionMode) permissionMode = selectedMode; return reply({ id: 'fixture-run', project: body.project === '~' ? '/home/user' : body.project, permissionMode: selectedMode, lumoUse: extensionSettings.lumoUse }); }
    if (path.endsWith('/stop')) return reply({ closed: true });
    if (path.endsWith('/answer')) { const body = route.request().postDataJSON(); answers.push(body); const index = questions.findIndex((question) => question.id === body.questionId); if (index >= 0) questions.splice(index, 1); return reply({ accepted: true }); }
    if (path.endsWith('/events')) { await new Promise((resolve) => setTimeout(resolve, 100)); return reply({ events: events.slice(Number(url.searchParams.get('after'))), cursor: events.length, closed, questions, retry, desktop: desktop.filter((request) => !desktopClaims.has(request.id)) }); }
    const command: PiCommand = route.request().postDataJSON().command; commands.push(command);
    let data: unknown = {};
    if (command.type === 'get_state') data = { model: models.find((item) => item.id === model), thinkingLevel: level, sessionFile: '/sessions/' + session, sessionName: name, isStreaming: busy };
    if (command.type === 'get_available_models') data = { models };
    if (command.type === 'get_available_thinking_levels') data = { levels: model === 'fast' ? ['off'] : ['off', 'low', 'medium', 'high'] };
    if (command.type === 'get_session_stats') data = { metrics: metrics.get(session), compaction: activeCompaction, cost: .012, contextUsage: { percent: 7, tokens: 14000, contextWindow: 200000 } };
    if (command.type === 'get_fork_messages') data = { messages: messages.flatMap((message, index) => message.role === 'user' ? [{ entryId: `entry-${index}`, text: typeof message.content === 'string' ? message.content : message.content.map((block) => block.text ?? '').join('') }] : []) };
    if (command.type === 'fork' || command.type === 'clone') {
      const index = command.type === 'fork' ? Number(command.entryId.replace('entry-', '')) : messages.length;
      originals.set(session, structuredClone(messages)); session = `fork-${++forks}.jsonl`;
      messages.splice(index);
      return reply({ type: 'response', command: command.type, success: true, eventCursor: events.length, data: { cancelled: false } });
    }
    if (command.type === 'clear_queue') { data = { steering: queue.filter((item) => item.type === 'steer').map((item) => item.message), followUp: queue.filter((item) => item.type === 'follow_up').map((item) => item.message) }; queue.length = 0; }
    if (command.type === 'get_messages') return reply({ type: 'response', command: command.type, success: true, eventCursor: events.length, questions, retry, data: { messages: originals.get(session) ?? (session === 'second.jsonl' ? [{ role: 'assistant', content: [{ type: 'text', text: 'Earlier saved conversation.' }] }] : messages) } });
    if (command.type === 'set_model') model = command.modelId;
    if (command.type === 'set_thinking_level') level = command.level;
    if (command.type === 'set_session_name') name = command.name;
    if (command.type === 'prompt' && busy && command.streamingBehavior) {
      queue.push({ type: command.streamingBehavior === 'steer' ? 'steer' : 'follow_up', message: command.message });
      return reply({ type: 'response', command: command.type, success: true, data: emptyQueueReplies ? {} : { disposition: 'queued' } });
    }
    if (command.type === 'prompt') {
      busy = true; data = { disposition: 'started' };
      const user: PiMessage = { role: 'user', content: [{ type: 'text', text: command.message }] }; messages.push(user);
      events.push({ type: 'agent_start' }, { type: 'message_start', message: user }, { type: 'message_end', message: user }, { type: 'message_start', message: { role: 'assistant', content: [] } }, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Inspecting your project…' } }, { type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: 'Inspecting your project…' }, { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'README.md' } }] } }, { type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read', args: { path: 'README.md' } });
    }
    if (command.type === 'steer' || command.type === 'follow_up') { queue.push(command); data = emptyQueueReplies ? {} : { disposition: 'queued' }; }
    if (command.type === 'abort_retry') { retry = null; busy = false; events.push({ type: 'agent_settled' }); }
    if (command.type === 'abort') { desktop.length = 0; questions.length = 0; retry = null; busy = false; events.push({ type: 'agent_settled' }); }
    return reply({ type: 'response', command: command.type, success: true, data });
  });
  return { commands, starts, originals, templates, desktopResults, requestDesktop(value: Omit<DesktopRequest, 'id' | 'expiresAt'>) {
    const request = { ...value, id: crypto.randomUUID(), expiresAt: Date.now() + 30000 }; desktop.push(request); return request.id;
  }, close(error?: string) { closed = true; busy = false; if (error) events.push({ type: 'error', error }); }, setHistory(history: PiMessage[]) { messages.splice(0, messages.length, ...history); }, emit(...incoming: PiEvent[]) { events.push(...incoming); }, setRetry(value: PiRetry | null) {
    const previous = retry; retry = value;
    if (value) {
      busy = true;
      if (value.source === 'response') {
        const message: PiMessage = { role: 'assistant', content: [], timestamp: Date.now(), stopReason: 'error', errorMessage: value.errorMessage };
        events.push({ type: 'message_start', message }, { type: 'message_end', message });
      }
      events.push({ type: value.source === 'summary' ? 'summarization_retry_scheduled' : 'auto_retry_start', attempt: value.attempt, maxAttempts: value.maxAttempts, delayMs: value.retryAt - Date.now(), errorMessage: value.errorMessage });
    } else events.push({ type: previous?.source === 'summary' ? 'summarization_retry_finished' : 'auto_retry_end' });
  }, setMetrics(session: string, value: PiSessionMetrics) { metrics.set(session, value); }, questions, answers, ask(question: PiQuestion) { busy = true; questions.push(question); }, emptyQueueReplies() { emptyQueueReplies = true; }, consumeQueued() {
    const index = queue.findIndex((item) => item.type === 'steer');
    const next = queue.splice(index < 0 ? 0 : index, 1)[0];
    if (!next) return;
    const user: PiMessage = { role: 'user', content: [{ type: 'text', text: next.message }] };
    messages.push(user); events.push({ type: 'message_start', message: user }, { type: 'message_end', message: user });
    return next;
  }, setExtensions(value: PiExtensionSettings['extensions']) { extensionSettings.extensions = value; }, setCompaction(value: { enabled: boolean; threshold: number }) { desiredCompaction = value; }, finish(text = 'The project uses **React and Go**.\n\nI found the application entry point.', stopReason = 'stop', errorMessage?: string) {
    busy = false; retry = null; questions.length = 0;
    const message: PiMessage = { role: 'assistant', stopReason, errorMessage, timestamp: Date.parse('2026-09-28T14:34:00Z'), content: [{ type: 'text', text }] };
    messages.push(message);
    events.push({ type: 'tool_execution_end', toolCallId: 'read-1', toolName: 'read', result: { content: [{ type: 'text', text: '# Lumo\nReact frontend and Go server.' }] } }, { type: 'message_start', message }, { type: 'message_end', message }, { type: 'agent_settled' });
  } };
}
export async function piPage(page: Page) {
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/desktop-apps') ? { apps: [], builds: [] } : path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } } : path.endsWith('/apps') ? { canInstall: false, apps: [{ id: 'pi', installed: true }] } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  return piFixture(page);
}
