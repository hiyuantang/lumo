// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from '@playwright/test';
import type { PiAuthState, PiCommand, PiEvent, PiMessage } from '../../src/api/pi';
export async function piFixture(page: Page) {
  let model = 'balanced'; let level = 'medium'; let session = 'first.jsonl'; let name = 'Project notes'; let busy = false;
  let desiredCompaction = { enabled: true, threshold: 160000 };
  let activeCompaction = { ...desiredCompaction };
  const events: PiEvent[] = []; const commands: PiCommand[] = []; const starts: { project: string; session: string }[] = [];
  const messages: PiMessage[] = [];
  const queue: { type: string; message: string }[] = [];
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
    if (path.endsWith('/start')) { activeCompaction = { ...desiredCompaction }; const body = route.request().postDataJSON(); starts.push(body); if (!body.session && !body.resume && starts.length > 1) messages.length = 0; session = body.session || (body.resume ? session : 'first.jsonl'); if (!body.resume) events.length = 0; return reply({ id: 'fixture-run', project: body.project === '~' ? '/home/user' : body.project }); }
    if (path.endsWith('/stop')) return reply({ closed: true });
    if (path.endsWith('/events')) { await new Promise((resolve) => setTimeout(resolve, 100)); return reply({ events: events.slice(Number(url.searchParams.get('after'))), cursor: events.length, closed: false }); }
    const command: PiCommand = route.request().postDataJSON().command; commands.push(command);
    let data: unknown = {};
    if (command.type === 'get_state') data = { model: models.find((item) => item.id === model), thinkingLevel: level, sessionFile: '/sessions/' + session, sessionName: name, isStreaming: busy };
    if (command.type === 'get_available_models') data = { models };
    if (command.type === 'get_available_thinking_levels') data = { levels: model === 'fast' ? ['off'] : ['off', 'low', 'medium', 'high'] };
    if (command.type === 'get_session_stats') data = { compaction: activeCompaction, cost: .012, contextUsage: { percent: 7, tokens: 14000, contextWindow: 200000 } };
    if (command.type === 'get_fork_messages') data = { messages: messages.flatMap((message, index) => message.role === 'user' ? [{ entryId: `entry-${index}`, text: typeof message.content === 'string' ? message.content : message.content.map((block) => block.text ?? '').join('') }] : []) };
    if (command.type === 'fork' || command.type === 'clone') {
      const index = command.type === 'fork' ? Number(command.entryId.replace('entry-', '')) : messages.length;
      originals.set(session, structuredClone(messages)); session = `fork-${++forks}.jsonl`;
      messages.splice(index);
      return reply({ type: 'response', command: command.type, success: true, eventCursor: events.length, data: { cancelled: false } });
    }
    if (command.type === 'clear_queue') { data = { steering: queue.filter((item) => item.type === 'steer').map((item) => item.message), followUp: queue.filter((item) => item.type === 'follow_up').map((item) => item.message) }; queue.length = 0; }
    if (command.type === 'get_messages') return reply({ type: 'response', command: command.type, success: true, eventCursor: events.length, data: { messages: originals.get(session) ?? (session === 'second.jsonl' ? [{ role: 'assistant', content: [{ type: 'text', text: 'Earlier saved conversation.' }] }] : messages) } });
    if (command.type === 'set_model') model = command.modelId;
    if (command.type === 'set_thinking_level') level = command.level;
    if (command.type === 'set_session_name') name = command.name;
    if (command.type === 'prompt') {
      busy = true; data = { disposition: 'started' };
      const user: PiMessage = { role: 'user', content: [{ type: 'text', text: command.message }] }; messages.push(user);
      events.push({ type: 'agent_start' }, { type: 'message_start', message: user }, { type: 'message_end', message: user }, { type: 'message_start', message: { role: 'assistant', content: [] } }, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Inspecting your project…' } }, { type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: 'Inspecting your project…' }, { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'README.md' } }] } }, { type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read', args: { path: 'README.md' } });
    }
    if (command.type === 'steer' || command.type === 'follow_up') { queue.push(command); data = emptyQueueReplies ? {} : { disposition: 'queued' }; }
    if (command.type === 'abort') { busy = false; events.push({ type: 'agent_settled' }); }
    return reply({ type: 'response', command: command.type, success: true, data });
  });
  return { commands, starts, originals, emptyQueueReplies() { emptyQueueReplies = true; }, consumeQueued() {
    const index = queue.findIndex((item) => item.type === 'steer');
    const next = queue.splice(index < 0 ? 0 : index, 1)[0];
    if (!next) return;
    const user: PiMessage = { role: 'user', content: [{ type: 'text', text: next.message }] };
    messages.push(user); events.push({ type: 'message_start', message: user }, { type: 'message_end', message: user });
    return next;
  }, setCompaction(value: { enabled: boolean; threshold: number }) { desiredCompaction = value; }, finish() {
    busy = false;
    const message: PiMessage = { role: 'assistant', stopReason: 'stop', timestamp: Date.parse('2026-09-28T14:34:00Z'), content: [{ type: 'text', text: 'The project uses **React and Go**.\n\nI found the application entry point.' }] };
    messages.push(message);
    events.push({ type: 'tool_execution_end', toolCallId: 'read-1', toolName: 'read', result: { content: [{ type: 'text', text: '# Lumo\nReact frontend and Go server.' }] } }, { type: 'message_start', message }, { type: 'message_end', message }, { type: 'agent_settled' });
  } };
}
export async function piPage(page: Page) {
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } } : path.endsWith('/apps') ? { canInstall: false, apps: [{ id: 'pi', installed: true }] } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  return piFixture(page);
}
