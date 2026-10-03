// SPDX-License-Identifier: AGPL-3.0-only
import type { AppNotification, AppNotificationMessage } from './notifications';
import type { NativeApp, NativeBundle, NativeChange } from './app-plugins';
import type { DesktopCatalog, DesktopChange, DesktopApp, DesktopLaunch } from './desktop-apps';
import type { CalendarSnapshot, CalendarChange, CalendarItem, CalendarGoogleStatus, CalendarGoogleConfig, CalendarGoogleAction, CalendarGoogleResult, CalendarNotice } from './calendar';
import { desktopClientId, type DesktopRequest, type PiExtensionSettings } from './lumo-use';
import type { GitSnapshot, GitDiff, GitAction } from './git';
import type { PiImageSettings, PiTemplate, PiConversationReference, PiCompaction, PiCompactionChange, PiProvider, PiConnection, PiAuthMethod, PiAuthState, PiInstruction, PiInstructionKind, PiArchivedSession, PiSession, PiCommand, PiReply, PiEvents, PiAnswer, PiPermissionMode, PiStart } from './pi';
import type { SkillCatalog, SkillDetail } from './skills';
import type { ProcessInfo } from './source';
import type { TrashItem, TrashSelection } from './trash';
import { formatModified } from '../utils/file-format';
import { base64ToText, textToBase64 } from './encoding';
import type {
  WireAuthLogin,
  WireAuthSession,
  WireFileEntry,
  WireFileRead,
  WireFilesList,
  WireFileWrite,
  WireIdentity,
  WireJournalEntry,
  WireJournalPage,
  WireMetricsSample,
  WireOverview,
  WirePrivilegedFileWrite,
  WireReauth,
  WireServiceActionResult,
  WireServiceDetail,
  WireServicesEvent,
  WireServicesList,
  WireServiceUnit,
  WireSessionUser,
  WireUpdatePlan,
  WireUpdateProgress,
} from './protocol';
import type {
  DataSource,
  FileRead,
  FileLocation,
  FileLocationSettings,
  FileWrite,
  FsEntry,
  JournalPage,
  JournalQuery,
  LoadSample,
  LogLine,
  LogPriority,
  NetworkConfig,
  NetworkConfirmation,
  NetworkSnapshot,
  PendingNetworkChange,
  PowerAction,
  PowerSchedule,
  PrivilegedFileWrite,
  ServiceAction,
  ServiceDetail,
  ServiceUnit,
  SessionUser,
  SourceCapabilities,
  SystemIdentity,
  SystemSettings,
  SystemSettingsChange,
  SystemOverview,
  TerminalHandlers,
  TerminalOpenOptions,
  TerminalSession,
  Unsubscribe,
  UpdatePlan,
  PackageCatalog,
  UpdateProgress,
  AppUpdateHistoryEntry,
} from './source';
import { ApiError, apiGet, apiPost, apiPut, csrfToken, onSessionExpired as onSessionExpiredListener } from './transport';
import { LumoSocket } from './ws';
import type { DockerResources, DockerResourceRequest, AppOperation, AppCatalog, AppLogs, ContainerAction, ContainerDetail, ContainerSnapshot, LibraryAppID, WebsiteDefinition, WebsiteResult, WebsiteSnapshot } from './server-apps';

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

const PRIORITY_MAP: Record<string, LogPriority> = {
  emerg: 'err',
  alert: 'err',
  crit: 'err',
  err: 'err',
  error: 'err',
  warning: 'warning',
  warn: 'warning',
  notice: 'info',
  info: 'info',
  debug: 'debug',
};

const PRIORITY_CODE: Record<LogPriority, 3 | 4 | 6 | 7> = {
  err: 3,
  warning: 4,
  info: 6,
  debug: 7,
};

let nextLogId = 1;

function mapServiceUnit(unit: WireServiceUnit): ServiceUnit {
  return {
    name: unit.name,
    description: unit.description ?? '',
    state: unit.activeState === 'active' ? 'active' : unit.activeState === 'failed' ? 'failed' : 'inactive',
    enabled: unit.enabledState === 'enabled',
    pid: null,
    memoryMb: 0,
    since: '—',
  };
}

function mapMetricsSample(sample: WireMetricsSample): LoadSample {
  const rx = sample.network.reduce((sum, iface) => sum + iface.rxBytesPerSec, 0);
  const tx = sample.network.reduce((sum, iface) => sum + iface.txBytesPerSec, 0);
  return {
    cpuPercent: Math.round(sample.cpu.usagePercent),
    netDownKbps: Math.round(rx / 1024),
    netUpKbps: Math.round(tx / 1024),
  };
}

function mapJournalEntry(entry: WireJournalEntry): LogLine {
  const priority = PRIORITY_MAP[entry.priority] ?? 'info';
  const pid = Number(entry.fields?._PID);
  return {
    id: nextLogId++,
    timestamp: Date.parse(entry.ts) || Date.now(),
    priority,
    priorityCode: PRIORITY_CODE[priority],
    unit: entry.unit,
    message: entry.message,
    pid: Number.isFinite(pid) ? pid : 0,
    hostname: entry.fields?._HOSTNAME ?? '',
    bootId: entry.fields?._BOOT_ID ?? '',
    fields: { ...(entry.fields ?? {}) },
  };
}

function mapFileEntry(entry: WireFileEntry): FsEntry {
  return {
    name: entry.name,
    kind: entry.type === 'directory' ? 'dir' : 'file',
    size: entry.sizeBytes,
    modified: formatModified(entry.modifiedAt),
    modifiedAt: entry.modifiedAt,
    mode: entry.mode,
    symlinkTarget: entry.symlinkTarget,
  };
}

function sortEntries(a: FsEntry, b: FsEntry): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function resolveFilePath(homeDir: string, path: string[]): string {
  const rest = path.slice(1).join('/');
  if (path[0] === '') return `/${rest}`;
  return rest ? `${homeDir === '/' ? '' : homeDir}/${rest}` : homeDir;
}

export class LiveDataSource implements DataSource {
  listNotifications() { return apiGet<AppNotification[]>('/notifications'); }
  changeNotifications(action: 'read' | 'dismiss', ids: string[]) { return apiPost<void>('/notifications/action', { action, ids }); }
  sendNotification(app: string, message: AppNotificationMessage) { return apiPost<AppNotification>('/notifications/send', { app, ...message }); }
  pluginRequest(name: string, body?: Record<string, unknown>): Promise<unknown> { const path = `/plugins/${encodeURIComponent(name)}`; return body ? apiPost(path, { ...body, requestId: crypto.randomUUID() }) : apiGet(path); }
  nativeApps() { return apiGet<NativeApp[]>('/app-plugins'); }
  importNativeApp(bundle: NativeBundle) { return apiPost<NativeApp[]>('/app-plugins/import', {requestId:crypto.randomUUID(),bundle}); }
  changeNativeApp(change: NativeChange) { return apiPost<NativeApp[]>('/app-plugins/action',change); }
  desktopApps() { return apiGet<DesktopCatalog>('/desktop-apps'); }
  desktopAppChange(change: DesktopChange) { return apiPost<DesktopApp>('/desktop-apps/action', change); }
  desktopAppLaunch(digest: string, preview: boolean) { return apiPost<DesktopLaunch>('/desktop-apps/launch', { digest, preview }); }
  desktopAppCall(token: string, method: string, params?: unknown) { return apiPost<unknown>('/desktop-apps/call', { token, method, params }); }
  async desktopAppReport(token: string, status: 'ready' | 'error', message: string) { await apiPost('/desktop-apps/report', { token, status, message }); }
  async desktopAppClose(token: string) { await apiPost('/desktop-apps/close', { token }); }
  calendarSnapshot(from: string, to: string, includeGoogle = true): Promise<CalendarSnapshot> { return apiGet(`/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&google=${includeGoogle ? 1 : 0}`); }
  calendarChange(change: CalendarChange): Promise<CalendarItem> { return apiPost('/calendar', { requestId: crypto.randomUUID(), ...change }); }
  calendarGoogleStatus(): Promise<CalendarGoogleStatus> { return apiGet('/calendar/google'); }
  calendarGoogle(action: CalendarGoogleAction, config?: CalendarGoogleConfig): Promise<CalendarGoogleResult> { return apiPost('/calendar/google', { requestId: crypto.randomUUID(), action, config }); }
  calendarNotices(): Promise<CalendarNotice[]> { return apiPost<{ notices: CalendarNotice[] }>('/calendar/notices', { requestId: crypto.randomUUID() }).then((value) => value.notices); }
  gitRepository(path: string): Promise<GitSnapshot> { return apiGet('/git/repository', { path }); }
  gitDiff(path: string, file: string, commit: string, staged: boolean): Promise<GitDiff> { return apiGet('/git/diff', { path, file, commit, staged: String(staged) }); }
  async gitAction(request: GitAction): Promise<void> { await apiPost('/git/action', { requestId: crypto.randomUUID(), ...request }); }
  piProviders(): Promise<{ providers: PiProvider[] }> { return apiGet('/pi/providers'); }
  piConnections(): Promise<{ providers: PiConnection[] }> { return apiGet('/pi/connections'); }
  piAuthStart(provider: string, method: PiAuthMethod, operation: 'login' | 'logout'): Promise<PiAuthState> { return apiPost('/pi/auth/start', { requestId: crypto.randomUUID(), provider, method, operation }); }
  piAuthState(id: string): Promise<PiAuthState> { return apiGet('/pi/auth', { id }); }
  piAuthReply(id: string, promptId: string, value: string): Promise<void> { return apiPost('/pi/auth/reply', { requestId: crypto.randomUUID(), id, promptId, value }); }
  piAuthCancel(id: string): Promise<void> { return apiPost('/pi/auth/cancel', { requestId: crypto.randomUUID(), id }); }
  piReference(project: string, session: string): Promise<Omit<PiConversationReference, 'name'>> { return apiGet('/pi/reference', { project, session }); }
  piCompaction(model: string): Promise<PiCompaction> { return apiGet('/pi/compaction', { model }); }
  piSaveCompaction(change: PiCompactionChange): Promise<PiCompaction> { return apiPost('/pi/compaction', { requestId: crypto.randomUUID(), ...change }); }
  piImageSettings(): Promise<PiImageSettings> { return apiGet('/pi/image-settings'); }
  piSaveImageSettings(change: PiImageSettings): Promise<PiImageSettings> { return apiPost('/pi/image-settings', { requestId: crypto.randomUUID(), ...change }); }
  piSettings(kind: PiInstructionKind): Promise<PiInstruction> { return apiGet('/pi/settings', { kind }); }
  piSaveSettings(kind: PiInstructionKind, content: string, revision: string): Promise<PiInstruction> { return apiPost('/pi/settings', { requestId: crypto.randomUUID(), kind, content, revision }); }
  async piSessions(project: string): Promise<PiSession[]> { return (await apiGet<{ sessions: PiSession[] }>('/pi/sessions', { project })).sessions; }
  async piDeleteSession(project: string, session: string): Promise<void> { await apiPost('/pi/sessions/delete', { requestId: crypto.randomUUID(), project, session }); }
  async piArchivedSessions(): Promise<PiArchivedSession[]> { return (await apiGet<{ sessions: PiArchivedSession[] }>('/pi/sessions/archived')).sessions; }
  async piArchiveSession(project: string, session: string): Promise<void> { await apiPost('/pi/sessions/archive', { requestId: crypto.randomUUID(), project, session }); }
  async piRestoreSession(project: string, session: string): Promise<void> { await apiPost('/pi/sessions/restore', { requestId: crypto.randomUUID(), project, session }); }
  async piTemplates(): Promise<PiTemplate[]> { return (await apiGet<{ templates: PiTemplate[] }>('/pi/templates')).templates; }
  async piSaveTemplate(template: Pick<PiTemplate, 'name' | 'content' | 'revision'>, remove = false): Promise<void> { await apiPost('/pi/templates', { ...template, delete: remove, requestId: crypto.randomUUID() }); }
  piUploadImage(content: string): Promise<{ path: string }> { return apiPost('/pi/images', { content, requestId: crypto.randomUUID() }); }
  async piStart(project: string, session = '', resume?: string, permissionMode?: PiPermissionMode, rememberPermissionMode = false): Promise<PiStart> { return apiPost('/pi/start', { requestId: crypto.randomUUID(), project, session, resume, permissionMode, rememberPermissionMode, clientId: await desktopClientId() }); }
  piCommand(id: string, command: PiCommand): Promise<PiReply> { return apiPost('/pi/command', { requestId: crypto.randomUUID(), id, command }); }
  piExtensions(): Promise<PiExtensionSettings> { return apiGet('/pi/extensions'); }
  piSaveExtensions(value: PiExtensionSettings): Promise<PiExtensionSettings> { return apiPost('/pi/extensions', { requestId: crypto.randomUUID(), revision: value.revision, lumoUse: value.lumoUse, questions: value.questions, calendar: value.calendar, appBuilder: value.appBuilder, extensions: value.extensions?.map(({ id, enabled }) => ({ id, enabled })) }); }
  async piDesktopClaim(id: string, desktopId: string): Promise<DesktopRequest> { return apiPost('/pi/desktop/claim', { requestId: crypto.randomUUID(), id, desktopId, clientId: await desktopClientId() }); }
  async piDesktopResult(id: string, desktopId: string, text: string, error: boolean): Promise<void> { await apiPost('/pi/desktop/result', { requestId: crypto.randomUUID(), id, desktopId, text, error, clientId: await desktopClientId() }); }
  async piAnswer(id: string, answer: PiAnswer, requestId: string): Promise<void> { await apiPost('/pi/answer', { requestId, id, ...answer }); }
  async piEvents(id: string, after: number): Promise<PiEvents> { return apiGet('/pi/events', { id, after, clientId: await desktopClientId() }); }
  async piStop(id: string): Promise<void> { await apiPost('/pi/stop', { id }); }

  getAppCatalog() { return apiGet<AppCatalog>('/apps'); }
  async uninstallPi(clean = false): Promise<void> { await apiPost('/apps/pi/uninstall', { requestId: crypto.randomUUID(), clean }); }

  async planAppInstall(id: LibraryAppID, operation: AppOperation = 'install'): Promise<UpdatePlan> {
    if (id === 'pi') return (await apiPost<{ plan: UpdatePlan }>('/apps/pi/plan', { requestId: crypto.randomUUID(), operation })).plan;
    return (await apiPost<{ plan: UpdatePlan }>('/apps/plan', { requestId: crypto.randomUUID(), appId: id, operation })).plan;
  }
  getDockerResources() { return apiGet<DockerResources>('/docker/resources'); }
  async runDockerResourceAction(request: DockerResourceRequest): Promise<void> { await apiPost('/docker/resource', { requestId: crypto.randomUUID(), ...request }); }
  getContainers() { return apiGet<ContainerSnapshot>('/containers'); }
  getContainer(id: string) { return apiGet<ContainerDetail>('/containers/detail', { id }); }
  getContainerLogs(id: string) { return apiGet<AppLogs>('/containers/logs', { id }); }
  runContainerAction(id: string, action: ContainerAction, revision: string) {
    return apiPost<ContainerDetail>('/containers/action', { requestId: crypto.randomUUID(), id, action, expectedRevision: revision });
  }
  getWebsites() { return apiGet<WebsiteSnapshot>('/websites'); }
  getWebsiteLogs(kind: 'access' | 'error') { return apiGet<AppLogs>('/websites/logs', { kind }); }
  saveWebsite(id: string, definition: WebsiteDefinition, revision: string) {
    return apiPost<WebsiteResult>('/websites/save', { requestId: crypto.randomUUID(), id, definition, expectedRevision: revision });
  }
  readonly kind = 'live' as const;
  readonly capabilities: SourceCapabilities = {
    isLive: true,
    canServiceActions: true,
    canTerminal: true,
    canPowerControl: true,
    canConfigureNetwork: false,
  };

  private socket = new LumoSocket();
  private identity: SystemIdentity | null = null;
  private identityExpiresAt = 0;
  private identityListeners = new Set<(hostname: string) => void>();
  private homeDir = '/home/user';
  private bootedAt = Date.now();
  private lastMetrics: WireMetricsSample | null = null;
  private cpuHistory: number[] = [];
  private units = new Map<string, WireServiceUnit>();

  async login(username: string, password: string): Promise<SessionUser> {
    const data = await apiPost<WireAuthLogin>('/auth/login', { username, password });
    if (data.csrf && !csrfToken()) {
      document.cookie = `lumo_csrf=${encodeURIComponent(data.csrf)}; path=/; SameSite=Strict`;
    }
    return this.noteSessionUser(data.user);
  }

  async logout(): Promise<void> {
    await apiPost('/auth/logout', {});
  }

  async getSession(): Promise<SessionUser | null> {
    try {
      const data = await apiGet<WireAuthSession>('/auth/session');
      return this.noteSessionUser(data.user);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unauthorized') return null;
      throw err;
    }
  }

  async reauth(password: string): Promise<void> {
    await apiPost<WireReauth>('/auth/reauth', { password });
  }

  onSessionExpired(listener: () => void): Unsubscribe {
    return onSessionExpiredListener(listener);
  }

  private noteSessionUser(user: WireSessionUser): SessionUser {
    if (user.home && user.home.startsWith('/')) {
      this.homeDir = user.home.replace(/\/+$/, '') || '/';
    }
    return { name: user.name, uid: user.uid, gid: user.gid, home: user.home };
  }

  async getIdentity(): Promise<SystemIdentity> {
    if (!this.identity || Date.now() >= this.identityExpiresAt) {
      const data = await apiGet<WireIdentity>('/system/identity');
      this.identity = {
        hostname: data.hostname,
        os: data.os.prettyName,
        kernel: data.os.kernel,
        architecture: data.architecture,
        cpuModel: data.cpuModel,
        bootId: data.bootId,
        serverTime: data.serverTime,
      };
      this.identityExpiresAt = Date.now() + 30_000;
      const home = data.user?.home;
      if (home && home.startsWith('/')) {
        this.homeDir = home.replace(/\/+$/, '') || '/';
      }
    }
    return this.identity;
  }

  async getSystemSettings(): Promise<SystemSettings> {
    return this.noteSettings(await apiGet<SystemSettings>('/system/settings'));
  }

  async getTimezones(): Promise<string[]> {
    return (await apiGet<{ timezones: string[] }>('/system/timezones')).timezones;
  }

  async updateSystemSettings(change: SystemSettingsChange, expectedRevision: string): Promise<SystemSettings> {
    return this.noteSettings(await apiPost<SystemSettings>('/system/settings', {
      requestId: crypto.randomUUID(), change, expectedRevision,
    }));
  }

  private noteSettings(settings: SystemSettings): SystemSettings {
    if (this.identity) {
      this.identity = { ...this.identity, hostname: settings.runtimeHostname, serverTime: settings.serverTime };
    }
    this.identityListeners.forEach((listener) => listener(settings.runtimeHostname));
    return settings;
  }

  onIdentityChanged(listener: (hostname: string) => void): Unsubscribe {
    this.identityListeners.add(listener);
    return () => this.identityListeners.delete(listener);
  }

  async listProcesses(): Promise<ProcessInfo[]> { return (await apiGet<{ processes: ProcessInfo[] }>('/system/processes')).processes; }

  async getOverview(): Promise<SystemOverview> {
    const [identity, overview, metrics] = await Promise.all([
      this.getIdentity(),
      apiGet<WireOverview>('/system/overview'),
      apiGet<WireMetricsSample>('/system/metrics'),
    ]);
    this.noteMetrics(metrics);
    this.bootedAt = Date.now() - overview.uptimeSeconds * 1000;
    const root = metrics.disks.find((disk) => disk.mount === '/') ?? metrics.disks[0];
    const alerts: SystemOverview['alerts'] = [];
    if (overview.failedUnits > 0) {
      alerts.push({
        id: 'failed-units',
        level: 'critical',
        text: `${overview.failedUnits} unit${overview.failedUnits === 1 ? '' : 's'} failed`,
      });
    }
    if (overview.securityUpdatesPending > 0) {
      alerts.push({
        id: 'security-updates',
        level: 'warning',
        text: `${overview.securityUpdatesPending} security update${overview.securityUpdatesPending === 1 ? ' is' : 's are'} ready to install`,
      });
    }
    if (overview.rebootRequired) {
      alerts.push({ id: 'reboot-required', level: 'info', text: 'A reboot is required to finish installing updates' });
    }
    return {
      hostname: identity.hostname,
      os: identity.os,
      kernel: identity.kernel,
      bootedAt: this.bootedAt,
      cpuPercent: Math.round(metrics.cpu.usagePercent),
      memoryUsedMb: Math.round(overview.memoryUsedBytes / MB),
      memoryTotalMb: Math.round(overview.memoryTotalBytes / MB),
      storageUsedGb: root ? Math.round(root.usedBytes / GB) : 0,
      storageTotalGb: root ? Math.round(root.totalBytes / GB) : 0,
      pendingUpdates: overview.updatesPending,
      securityUpdates: overview.securityUpdatesPending,
      alerts,
      cpuHistory: [...this.cpuHistory],
      cpuCores: metrics.cpu.cores,
      cpuPerCore: metrics.cpu.perCore ?? [],
      cpuLoad: [metrics.cpu.load1, metrics.cpu.load5, metrics.cpu.load15],
      network: metrics.network,
    };
  }

  async runPowerAction(action: PowerAction): Promise<PowerSchedule> {
    return apiPost<PowerSchedule>('/system/power', { requestId: crypto.randomUUID(), action });
  }

  async getNetworkSnapshot(): Promise<NetworkSnapshot> {
    return apiGet<NetworkSnapshot>('/network');
  }

  async applyNetworkConfig(
    config: NetworkConfig,
    expectedRevision: string,
    confirmTimeoutSec = 90,
  ): Promise<PendingNetworkChange> {
    return apiPost<PendingNetworkChange>('/network/apply', {
      requestId: crypto.randomUUID(),
      config,
      expectedRevision,
      confirmTimeoutSec,
    });
  }

  async confirmNetworkConfig(token: string): Promise<NetworkConfirmation> {
    return apiPost<NetworkConfirmation>('/network/confirm', {
      requestId: crypto.randomUUID(),
      token,
    });
  }

  uptimeSeconds(): number {
    return Math.max(0, Math.floor((Date.now() - this.bootedAt) / 1000));
  }

  sampleLoad(): LoadSample {
    return this.lastMetrics
      ? mapMetricsSample(this.lastMetrics)
      : { cpuPercent: 0, netDownKbps: 0, netUpKbps: 0 };
  }

  subscribeMetrics(onSample: (sample: LoadSample) => void, intervalMs = 2000): Unsubscribe {
    const handle = this.socket.subscribe({
      capability: 'system.metrics',
      params: () => ({ intervalMs }),
      onEvent: (data) => {
        const sample = data as WireMetricsSample;
        this.noteMetrics(sample);
        onSample(mapMetricsSample(sample));
      },
    });
    return handle.close;
  }

  private noteMetrics(sample: WireMetricsSample) {
    this.lastMetrics = sample;
    this.cpuHistory.push(Math.round(sample.cpu.usagePercent));
    if (this.cpuHistory.length > 24) this.cpuHistory.shift();
  }

  async listServices(): Promise<ServiceUnit[]> {
    const data = await apiGet<WireServicesList>('/services');
    this.units.clear();
    for (const unit of data.units) this.units.set(unit.name, unit);
    return data.units.map(mapServiceUnit);
  }

  async getServiceDetail(name: string): Promise<ServiceDetail> {
    const detail = await apiGet<WireServiceDetail>('/services/detail', { name });
    return {
      name: detail.name,
      documentation: detail.documentation ?? [],
      dependencies: detail.dependencies ?? [],
      files: (detail.files ?? []).map((file) => ({
        path: file.path,
        content: file.content ?? null,
        override: file.override,
        error: file.error ?? null,
      })),
    };
  }

  subscribeServices(onChange: (units: ServiceUnit[]) => void): Unsubscribe {
    const handle = this.socket.subscribe({
      capability: 'services.subscribe',
      params: () => ({}),
      onEvent: (data) => {
        const event = data as WireServicesEvent;
        if (event.kind === 'snapshot') {
          this.units.clear();
          for (const unit of event.units) this.units.set(unit.name, unit);
        } else {
          this.mergeServiceUnit(event.unit.name, event.unit);
        }
        onChange([...this.units.values()].map(mapServiceUnit).sort((a, b) => a.name.localeCompare(b.name)));
      },
    });
    return handle.close;
  }

  async runServiceAction(name: string, action: ServiceAction, expectedActiveState?: string): Promise<ServiceUnit> {
    const data = await apiPost<WireServiceActionResult>('/services/action', {
      requestId: crypto.randomUUID(),
      action,
      unit: name,
      ...(expectedActiveState ? { expected: { activeState: expectedActiveState } } : {}),
    });
    return mapServiceUnit(this.mergeServiceUnit(name, data.unit));
  }

  private mergeServiceUnit(name: string, unit: Partial<WireServiceUnit>): WireServiceUnit {
    const fallback = this.units.get(name) ?? {
      name,
      description: '',
      loadState: 'loaded',
      activeState: 'inactive',
      subState: 'dead',
      enabledState: 'disabled',
    };
    const merged = { ...fallback, ...unit };
    this.units.set(name, merged);
    return merged;
  }

  async queryJournal(query: JournalQuery = {}): Promise<JournalPage> {
    const data = await apiGet<WireJournalPage>('/journal', {
      unit: query.unit,
      priority: query.priority,
      since: query.since,
      boot: query.boot,
      limit: query.limit,
      'after-cursor': query.after,
    });
    return { entries: data.entries.map(mapJournalEntry), nextCursor: data.nextCursor };
  }

  streamJournal(onEntry: (entry: LogLine) => void, onError?: (err: Error) => void): Unsubscribe {
    let lastCursor: string | null = null;
    const seen = new Set<string>();
    const remember = (cursor: string) => {
      seen.add(cursor);
      if (seen.size > 500) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
    };
    const handle = this.socket.subscribe({
      capability: 'journal.stream',
      params: () => ({ after: lastCursor }),
      onEvent: (data) => {
        const entry = data as WireJournalEntry;
        if (entry.cursor) {
          if (seen.has(entry.cursor)) return;
          remember(entry.cursor);
          lastCursor = entry.cursor;
        }
        onEntry(mapJournalEntry(entry));
      },
      onError: (err) => onError?.(err),
    });
    return handle.close;
  }

  async listJournalUnits(): Promise<string[]> {
    const data = await apiGet<WireJournalPage>('/journal', { limit: 200 });
    return [...new Set(data.entries.map((entry) => entry.unit))].sort();
  }

  listSkills(): Promise<SkillCatalog> { return apiGet('/skills'); }
  readSkill(id: string): Promise<SkillDetail> { return apiGet('/skills/detail', { id }); }

  getFileLocationSettings(): Promise<FileLocationSettings> {
    return apiGet('/files/locations/settings');
  }

  planFileLocationMove(path: string, revision: string, id?: string): Promise<{ files: number; bytes: number; create: number }> {
    return apiGet('/files/locations/plan', { path, revision, ...(id ? { id } : {}) });
  }

  setFileLocation(id: string, path: string, revision: string, remove = false): Promise<FileLocationSettings> {
    return apiPost('/files/locations/settings', { id, path, remove, expectedRevision: revision, requestId: crypto.randomUUID() });
  }

  setFileLocationBase(path: string, revision: string): Promise<FileLocationSettings> {
    return apiPost('/files/locations/settings', { path, expectedRevision: revision, requestId: crypto.randomUUID() });
  }

  async listFileLocations(): Promise<FileLocation[]> {
    const data = await apiGet<{ locations: FileLocation[] }>('/files/locations');
    return data.locations ?? [];
  }

  homePath(): string[] {
    const segment = this.homeDir.split('/').filter(Boolean).pop();
    return [segment ?? 'user'];
  }

  absolutePath(path: string[]): string {
    return resolveFilePath(this.homeDir, path);
  }

  async createEntry(path: string[], kind: 'file' | 'directory'): Promise<void> {
    await apiPost('/files/create', { path: this.absolutePath(path), kind, requestId: crypto.randomUUID() });
  }

  async listDir(path: string[]): Promise<FsEntry[]> {
    const data = await apiGet<WireFilesList>('/files/list', { path: resolveFilePath(this.homeDir, path) });
    return data.entries.map(mapFileEntry).sort(sortEntries);
  }

  readFile(path: string[], preview?: 'image'): Promise<FileRead> {
    return this.readSystemFile(resolveFilePath(this.homeDir, path), preview);
  }

  async readSystemFile(path: string, preview?: 'image'): Promise<FileRead> {
    const data = await apiGet<WireFileRead>('/files/read', { path, ...(preview ? { preview } : {}) });
    const content = data.encoding === 'utf-8' || data.encoding === 'ascii' ? base64ToText(data.content) : null;
    return {
      content,
      contentBase64: data.content,
      revision: data.revision,
      truncated: data.truncated,
      sizeBytes: data.sizeBytes,
    };
  }

  async writeFile(path: string[], contentBase64: string, expectedRevision: string | null): Promise<FileWrite> {
    const data = await apiPut<WireFileWrite>('/files/write', {
      path: resolveFilePath(this.homeDir, path),
      content: contentBase64,
      ...(expectedRevision ? { expectedRevision } : {}),
      requestId: crypto.randomUUID(),
    });
    return { revision: data.revision, sizeBytes: data.sizeBytes };
  }

  async writePrivilegedFile(
    path: string,
    contentBase64: string,
    expectedRevision: string,
    restartUnit?: string,
  ): Promise<PrivilegedFileWrite> {
    const data = await apiPost<WirePrivilegedFileWrite>('/files/write-privileged', {
      path,
      content: contentBase64,
      expectedRevision,
      ...(restartUnit ? { restartUnit } : {}),
      requestId: crypto.randomUUID(),
    });
    return {
      revision: data.file.revision,
      sizeBytes: data.file.sizeBytes,
      rollbackRef: data.file.rollbackRef,
      validation: data.file.validation,
      restart: data.restart ?? null,
    };
  }

  async listTrash(): Promise<TrashItem[]> { return (await apiGet<{ items: TrashItem[] }>('/trash')).items; }
  async restoreTrash(item: TrashSelection): Promise<string> { return (await apiPost<{ path: string }>('/trash/restore', { requestId: crypto.randomUUID(), item })).path; }
  async deleteTrash(items: TrashSelection[]): Promise<void> { await apiPost('/trash/delete', { requestId: crypto.randomUUID(), items }); }

  async moveFile(from: string[], to: string[]): Promise<void> {
    await apiPost('/files/move', { from: this.absolutePath(from), to: this.absolutePath(to), requestId: crypto.randomUUID() });
  }

  async deleteFile(path: string[]): Promise<void> {
    await apiPost<{ trashed: boolean }>('/files/delete', {
      path: resolveFilePath(this.homeDir, path),
      requestId: crypto.randomUUID(),
    });
  }

  async getAppUpdateHistory(): Promise<AppUpdateHistoryEntry[]> { return (await apiGet<{ entries: AppUpdateHistoryEntry[] }>('/apps/update-history')).entries; }

  getPackageCatalog(): Promise<PackageCatalog> { return apiGet('/updates/packages'); }

  async refreshUpdates(): Promise<string> {
    const data = await apiPost<{ refreshedAt: string }>('/updates/refresh', { requestId: crypto.randomUUID() });
    return data.refreshedAt;
  }

  async calculateUpdatePlan(): Promise<UpdatePlan> {
    const data = await apiPost<{ plan: WireUpdatePlan }>('/updates/plan', { requestId: crypto.randomUUID() });
    return data.plan;
  }

  async applyUpdatePlan(planId: string, clean = false): Promise<string> {
    const pi = planId.startsWith('pi_');
    const requestId = `${pi ? 'pi_' : ''}${crypto.randomUUID()}`;
    const data = await apiPost<{ requestId: string }>(pi ? '/apps/pi/apply' : '/updates/apply', { requestId, planId, ...(!pi ? { clean } : {}) });
    return data.requestId;
  }

  subscribeUpdateProgress(
    requestId: string,
    onProgress: (progress: UpdateProgress) => void,
    onError?: (err: Error) => void,
  ): Unsubscribe {
    if (requestId.startsWith('pi_')) {
      let active = true;
      let timer: ReturnType<typeof setTimeout>;
      const poll = async () => {
        try {
          const progress = await apiGet<UpdateProgress>('/apps/pi/progress', { requestId });
          if (!active) return;
          onProgress(progress);
          if (!progress.done && active) timer = setTimeout(() => { void poll(); }, 800);
        } catch (err) { if (active) onError?.(err instanceof Error ? err : new Error(String(err))); }
      };
      void poll();
      return () => { active = false; clearTimeout(timer); };
    }
    const handle = this.socket.subscribe({
      capability: 'updates.progress',
      params: () => ({ requestId }),
      onEvent: (data) => onProgress(data as WireUpdateProgress),
      onError: (err) => onError?.(err),
    });
    return handle.close;
  }

  openTerminal(opts: TerminalOpenOptions, handlers: TerminalHandlers): TerminalSession {
    return new LiveTerminalSession(this.socket, opts, handlers);
  }
}

class LiveTerminalSession implements TerminalSession {
  private cols: number;
  private rows: number;
  private sessionToken: string | null = null;
  private exited = false;
  private handle: { channel: number; close: () => void };

  constructor(
    private socket: LumoSocket,
    opts: TerminalOpenOptions,
    private handlers: TerminalHandlers,
  ) {
    this.cols = opts.cols;
    this.rows = opts.rows;
    this.handle = this.socket.subscribe({
      capability: 'terminal.open',
      params: () => ({
        cols: this.cols,
        rows: this.rows,
        shell: null,
        ...(opts.program ? { program: opts.program, directory: opts.directory } : {}),
        ...(this.sessionToken ? { session: this.sessionToken } : {}),
      }),
      onSubscribed: (data, reattached) => {
        const token = (data as { session?: unknown } | undefined)?.session;
        if (typeof token === 'string') this.sessionToken = token;
        if (reattached) this.handlers.onReset?.();
      },
      onEvent: (data) => {
        const frame = data as { kind?: string; data?: string; code?: number };
        if (frame.kind === 'stdout' && typeof frame.data === 'string') {
          this.handlers.onData(base64ToText(frame.data));
        } else if (frame.kind === 'exit') {
          this.exited = true;
          this.handlers.onExit(typeof frame.code === 'number' ? frame.code : 0);
        }
      },
      onError: (err) => this.handlers.onError?.(err),
    });
  }

  write(data: string): void {
    if (this.exited) return;
    this.socket.sendInput(this.handle.channel, { kind: 'stdin', data: textToBase64(data) });
  }

  resize(cols: number, rows: number): void {
    if (this.exited || (cols === this.cols && rows === this.rows)) return;
    this.cols = cols;
    this.rows = rows;
    this.socket.sendInput(this.handle.channel, { kind: 'resize', cols, rows });
  }

  close(): void {
    this.handle.close();
  }
}
