// SPDX-License-Identifier: AGPL-3.0-only
import type { PiContextBudget, PiCompaction, PiCompactionChange, PiProvider, PiAuthMethod, PiAuthState, PiInstruction, PiInstructionKind, PiCommand, PiData, PiEvent, PiEvents, PiMessage, PiModel, PiReply, PiSession } from '../api/pi';
const models: PiModel[] = [{ id: 'demo-balanced', name: 'Balanced', provider: 'Demo', reasoning: true }, { id: 'demo-fast', name: 'Fast', provider: 'Demo' }];
interface Saved { archived?: boolean; session: PiSession; project: string; messages: PiMessage[]; model: PiModel; level: string }
interface Run { saved: Saved; events: PiEvent[]; busy: boolean; queue: { type: 'steer' | 'follow_up'; message: string }[]; model: PiModel; level: string; timer?: number }
const instructions = new Map<PiInstructionKind, PiInstruction>();
let compactionDefaults: { usageBudget?: PiContextBudget; enabled: boolean; reserveTokens: number; keepRecentTokens: number; revision: string } = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000, revision: 'initial' };
const compactionOverrides = new Map<string, { reserveTokens: number; keepRecentTokens: number }>();
const saved: Saved[] = [];
let lastSelection = { model: models[0], level: 'medium' };
const runs = new Map<string, Run>();
export const mockPi = {
  async reference(project: string, session: string) { if (!saved.some((item) => item.project === project && item.session.id === session)) throw new Error('This saved conversation is unavailable.'); return { project, session, path: `/home/user/.local/state/lumo/pi-sessions/demo/${session}.jsonl`, reader: '/usr/local/bin/lumod' }; },
  async compaction(model: string): Promise<PiCompaction> {
    return { ...compactionDefaults, model, defaultReserveTokens: compactionDefaults.reserveTokens, defaultKeepRecentTokens: compactionDefaults.keepRecentTokens, customized: compactionOverrides.has(model), ...compactionOverrides.get(model) };
  },
  async saveCompaction(change: PiCompactionChange): Promise<PiCompaction> {
    if (change.revision !== compactionDefaults.revision) throw new Error('Pi settings changed on the server. Reload before saving.');
    compactionDefaults = { ...compactionDefaults, usageBudget: change.usageBudget, enabled: change.enabled, revision: crypto.randomUUID() };
    if (change.usageBudget) compactionOverrides.clear();
    if (!change.model) { compactionDefaults.reserveTokens = change.reserveTokens; compactionDefaults.keepRecentTokens = change.keepRecentTokens; }
    else if (change.customized) compactionOverrides.set(change.model, { reserveTokens: change.reserveTokens, keepRecentTokens: change.keepRecentTokens });
    else compactionOverrides.delete(change.model);
    return mockPi.compaction(change.model);
  },
  async providers(): Promise<{ providers: PiProvider[] }> { return { providers: [{ id: 'demo', name: 'Demo', methods: [], credential: 'api_key' }] }; },
  async authStart(_provider: string, _method: PiAuthMethod, _operation: 'login' | 'logout'): Promise<PiAuthState> { throw new Error('Provider sign-in is available on your server. Demo never stores credentials.'); },
  async authState(_id: string): Promise<PiAuthState> { throw new Error('No provider setup is running.'); },
  async authReply(_id: string, _promptId: string, _value: string): Promise<void> {},
  async authCancel(_id: string): Promise<void> {},
  async settings(kind: PiInstructionKind): Promise<PiInstruction> { return instructions.get(kind) ?? { kind, path: '/home/user/.pi/agent/' + (kind === 'instructions' ? 'AGENTS.md' : 'APPEND_SYSTEM.md'), content: '', revision: '', exists: false }; },
  async saveSettings(kind: PiInstructionKind, content: string, revision: string): Promise<PiInstruction> {
    const before = await mockPi.settings(kind);
    if (before.revision !== revision) throw new Error('Instructions changed on the server. Reload before saving.');
    const value = { ...before, content, exists: true, revision: crypto.randomUUID() }; instructions.set(kind, value); return value;
  },
  clear() { compactionDefaults = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000, revision: 'initial' }; compactionOverrides.clear(); instructions.clear(); for (const run of runs.values()) window.clearTimeout(run.timer); runs.clear(); saved.length = 0; lastSelection = { model: models[0], level: 'medium' }; },
  async sessions(project: string) { project = project === '~' ? '/home/user' : project; return saved.filter((item) => item.project === project && !item.archived).map((item) => item.session); },
  async deleteSession(project: string, session: string) {
    project = project === '~' ? '/home/user' : project;

    const index = saved.findIndex((item) => item.project === project && item.session.id === session && item.archived);
    if (index >= 0) saved.splice(index, 1);
  },
  async archivedSessions() { return saved.filter((item) => item.archived).map((item) => ({ ...item.session, project: item.project })); },
  async archiveSession(project: string, session: string) {
    if ([...runs.values()].some((run) => run.saved.project === project)) throw new Error("Close this project's Pi connection before archiving.");
    const item = saved.find((item) => item.project === project && item.session.id === session);
    if (!item) throw new Error('Conversation is unavailable.'); item.archived = true;
  },
  async restoreSession(project: string, session: string) {
    if ([...runs.values()].some((run) => run.saved.project === project)) throw new Error("Close this project's Pi connection before restoring.");
    const item = saved.find((item) => item.project === project && item.session.id === session);
    if (!item) throw new Error('Conversation is unavailable.'); item.archived = false;
  },
  async start(project: string, session?: string) {
    project = project === '~' ? '/home/user' : project;
    const id = crypto.randomUUID();
    let item = saved.find((item) => item.session.id === session && item.project === project && !item.archived);
    if (!item) { item = { ...lastSelection, project, messages: [], session: { id: `${id}.jsonl`, name: 'New conversation', modified: new Date().toISOString() } }; saved.unshift(item); }
    runs.set(id, { saved: item, events: [], busy: false, queue: [], model: item.model, level: item.level });
    return { id, project: project === '~' ? '/home/user' : project };
  },
  async command(id: string, command: PiCommand): Promise<PiReply> {
    const run = runs.get(id); if (!run) throw new Error('Pi has stopped.');
    let data: PiData = {};
    const emit = (event: PiEvent) => { run.events.push(event); };
    if (command.type === 'get_state') data = { model: run.model, thinkingLevel: run.level, isStreaming: run.busy, sessionFile: `/demo/${run.saved.session.id}`, sessionName: run.saved.session.name };
    if (command.type === 'get_fork_messages') return { type: 'response', command: command.type, success: true, data: { messages: run.saved.messages.flatMap((message, index) => message.role === 'user' ? [{ entryId: `entry-${index}`, text: typeof message.content === 'string' ? message.content : message.content.map((block) => block.text ?? '').join('') }] : []) } as unknown as PiData };
    if (command.type === 'fork' || command.type === 'clone') {
      const index = command.type === 'fork' ? Number(command.entryId.replace(/^entry-/, '')) : run.saved.messages.length;
      if (run.busy || !Number.isInteger(index) || (command.type === 'fork' && run.saved.messages[index]?.role !== 'user')) return { type: 'response', command: command.type, success: false, error: 'Choose an earlier message after stopping Pi.' };
      const original = run.saved;
      const item = { model: run.model, level: run.level, project: original.project, messages: structuredClone(original.messages.slice(0, index)), session: { id: `${crypto.randomUUID()}.jsonl`, name: `${original.session.name} · edited`, modified: new Date().toISOString() } };
      saved.unshift(item); run.saved = item;
      return { type: 'response', command: command.type, success: true, eventCursor: run.events.length, data: { cancelled: false } };
    }
    if (command.type === 'clear_queue') { data = { steering: run.queue.filter((item) => item.type === 'steer').map((item) => item.message), followUp: run.queue.filter((item) => item.type === 'follow_up').map((item) => item.message) }; run.queue = []; }
    if (command.type === 'get_messages') data = { messages: [...run.saved.messages] };
    if (command.type === 'get_available_models') data = { models };
    if (command.type === 'get_available_thinking_levels') data = { levels: run.model.reasoning ? ['off', 'low', 'medium', 'high'] : ['off'] };
    if (command.type === 'get_session_stats') data = { compaction: { enabled: compactionDefaults.enabled, threshold: compactionDefaults.usageBudget ? compactionDefaults.usageBudget.mode === 'percent' ? Math.floor(200000 * compactionDefaults.usageBudget.value / 100) : Math.min(183616, compactionDefaults.usageBudget.value) : 200000 - compactionDefaults.reserveTokens }, tokens: { total: run.saved.messages.length * 240 }, cost: 0, contextUsage: { percent: 2, tokens: 4000, contextWindow: 200000 } };
    if (command.type === 'set_model') {
      const model = models.find((model) => model.id === command.modelId && model.provider === command.provider);
      if (!model) return { type: 'response', command: command.type, success: false, error: 'Model is unavailable.' };
      run.model = model; if (!model.reasoning) run.level = 'off';
    }
    if (command.type === 'set_thinking_level') run.level = run.model.reasoning ? command.level : 'off';
    if (command.type === 'set_model' || command.type === 'set_thinking_level') {
      lastSelection = { model: run.model, level: run.level }; Object.assign(run.saved, lastSelection);
    }
    if (command.type === 'set_session_name') run.saved.session.name = command.name;
    if (command.type === 'abort') { window.clearTimeout(run.timer); run.busy = false; emit({ type: 'agent_settled' }); }
    if (command.type === 'compact') { emit({ type: 'auto_compaction_start' }); emit({ type: 'auto_compaction_end' }); }
    if (command.type === 'prompt' || command.type === 'steer' || command.type === 'follow_up') {
      if (run.busy) {
        if (command.type === 'prompt') return { type: 'response', command: command.type, success: false, error: 'Demo is working. Stop the current reply before sending another.' };
        run.queue.push({ type: command.type, message: command.message });
        return { type: 'response', command: command.type, success: true, data: { disposition: 'queued' } };
      }
      run.busy = true; data.disposition = 'started';
      const user: PiMessage = { role: 'user', timestamp: Date.now(), content: [{ type: 'text', text: command.message }] };
      run.saved.messages.push(user); run.saved.session.name = command.message.slice(0, 70);
      emit({ type: 'agent_start' }); emit({ type: 'message_start', message: user }); emit({ type: 'message_end', message: user });
      emit({ type: 'tool_execution_start', toolCallId: id + run.saved.messages.length, toolName: 'read', args: { path: 'README.md' } });
      run.timer = window.setTimeout(() => {
        const tool: PiMessage = { role: 'toolResult', toolCallId: id + run.saved.messages.length, toolName: 'read', content: [{ type: 'text', text: '# Project\nA demonstration workspace.' }] };
        run.saved.messages.push(tool); emit({ type: 'tool_execution_end', toolCallId: tool.toolCallId, toolName: 'read', result: { content: tool.content as [] } });
        emit({ type: 'message_start', message: { role: 'assistant', timestamp: Date.now(), content: [] } });
        emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'I read the project overview. ' } });
        run.timer = window.setTimeout(() => {
          const message: PiMessage = { role: 'assistant', timestamp: Date.now(), content: [{ type: 'text', text: 'I read the project overview.\n\nThis is a **demo conversation**. On your server, Pi can read files, edit code, and run commands in this project.' }] };
          run.saved.messages.push(message); emit({ type: 'message_end', message }); run.busy = false;
          const next = run.queue.shift();
          if (next) void mockPi.command(id, { type: 'prompt', message: next.message }); else emit({ type: 'agent_settled' });
        }, 450);
      }, 450);
    }
    return { type: 'response', command: command.type, success: true, data };
  },
  async events(id: string, after: number): Promise<PiEvents> { await new Promise((resolve) => window.setTimeout(resolve, 150)); const run = runs.get(id); return { events: run?.events.slice(after) ?? [], cursor: run?.events.length ?? after, closed: !run }; },
  async stop(id: string) { const run = runs.get(id); window.clearTimeout(run?.timer); runs.delete(id); },
};
