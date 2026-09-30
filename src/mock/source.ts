// SPDX-License-Identifier: AGPL-3.0-only
import { MockGit } from './git';
import type { GitAction } from '../api/git';
import { mockPi } from './pi';
import { mockSkills } from './skills';
import type { SkillCatalog, SkillDetail } from '../api/skills';
import type { TrashItem, TrashSelection } from '../api/trash';
import { base64ToText, textToBase64 } from '../api/encoding';
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
  UpdateProgress,
} from '../api/source';
import { ApiError } from '../api/transport';
import { MockServerApps } from './server-apps';
import type { DockerResourceRequest, AppOperation, AppCatalog, ContainerAction, LibraryAppID, WebsiteDefinition } from '../api/server-apps';
import {
  moveEntry, deleteEntry, appFileFixtures, cleanAppFiles, listTrashed, restoreTrashed, removeTrashed,
  entryRevision,
  getEntry,
  homePath as mockHomePath,
  createEntry as mockCreateEntry,
  listDir as mockListDir,
  writeEntry,
} from './filesystem';
import { LOG_UNITS, makeLogLine, seedLogLines } from './journal';
import {
  getOverview,
  listServices,
  getServiceDetail,
  runServiceAction,
  sampleLoad,
  subscribeServices,
  uptimeSeconds,
} from './system';
import { MockTerminalSession } from './terminal';
import { readSystemFile, writePrivilegedFile } from './privileged-files';
import {
  applyUpdatePlan,
  getAppUpdateHistory,
  rememberAppPlan,
  calculateUpdatePlan,
  refreshUpdates,
  getPackageCatalog,
  subscribeUpdateProgress,
} from './updates';

const TICK_MS = 2000;

export class MockDataSource implements DataSource {
  private git = new MockGit();
  gitRepository(path: string) { return this.git.repository(path); }
  gitDiff(path: string, file: string, commit: string, staged: boolean) { return this.git.diff(path, file, commit, staged); }
  gitAction(request: GitAction) { return this.git.action(request); }
  piTemplates = mockPi.templates;
  piSaveTemplate = mockPi.saveTemplate;
  piUploadImage = async (_content: string): Promise<{ path: string }> => { throw new Error('Image uploads require a connected server.'); };
  piProviders = mockPi.providers;
  piConnections = mockPi.connections;
  piAuthStart = mockPi.authStart;
  piAuthState = mockPi.authState;
  piAuthReply = mockPi.authReply;
  piAuthCancel = mockPi.authCancel;
  piReference = mockPi.reference;
  piCompaction = mockPi.compaction;
  piSaveCompaction = mockPi.saveCompaction;
  piImageSettings = mockPi.imageSettings;
  piSaveImageSettings = mockPi.saveImageSettings;
  piSettings = mockPi.settings;
  piSaveSettings = mockPi.saveSettings;
  piSessions = mockPi.sessions;
  piDeleteSession = mockPi.deleteSession;
  piArchivedSessions = mockPi.archivedSessions;
  piArchiveSession = mockPi.archiveSession;
  piRestoreSession = mockPi.restoreSession;
  piStart = mockPi.start;
  piCommand = mockPi.command;
  piEvents = mockPi.events;
  private piExtensionSettings: import('../api/lumo-use').PiExtensionSettings = { lumoUse: true, questions: true, revision: 'initial', extensions: [] };
  piExtensions = async () => this.piExtensionSettings;
  piSaveExtensions = async (value: typeof this.piExtensionSettings) => { this.piExtensionSettings = { ...value, revision: crypto.randomUUID() }; return this.piExtensionSettings; };
  piDesktopClaim = async (): Promise<never> => { throw new Error('Lumo Use needs a live Pi chat.'); };
  piDesktopResult = async () => {};
  piAnswer = async () => {};
  piStop = mockPi.stop;

  constructor() { appFileFixtures('docker'); appFileFixtures('nginx'); }
  private removedApps = new Set<LibraryAppID>();
  async getAppCatalog(): Promise<AppCatalog> { return { canInstall: true, apps: [{ id: 'git', installed: !this.removedApps.has('git') }, { id: 'docker', installed: !this.removedApps.has('docker') }, { id: 'nginx', installed: !this.removedApps.has('nginx') }, { id: 'pi', installed: Boolean(this.piVersion), canInstall: true, canUpdate: Boolean(this.piVersion), canUninstall: true }] }; }
  private piVersion = '';
  async uninstallPi(clean = false): Promise<void> { this.piVersion = ''; if (clean) { cleanAppFiles('pi'); mockPi.clear(); } }
  async planAppInstall(id: LibraryAppID, operation: AppOperation = 'install'): Promise<UpdatePlan> {
    if (id === 'pi') {
      const packages = this.piVersion !== '1.2.1' ? [{ name: 'pi', fromVersion: this.piVersion, toVersion: '1.2.1', security: false, downloadBytes: 0, installedDeltaBytes: 0 }] : [];
      return rememberAppPlan({ ...await calculateUpdatePlan(), appId: id, operation, packages, downloadBytes: 0 }, () => { this.piVersion = '1.2.1'; appFileFixtures('pi'); });
    }
    if (id === 'git') return rememberAppPlan({ ...await calculateUpdatePlan(), appId: id, operation, packages: operation === 'update' && this.updatedGit ? [] : [{ name: 'git', fromVersion: '2.43.0', toVersion: '2.43.1', security: false, downloadBytes: 0, installedDeltaBytes: 0 }], downloadBytes: 0 }, () => { if (operation === 'uninstall') this.removedApps.add(id); else { this.removedApps.delete(id); this.updatedGit = true; } });
    const updated = id === 'docker' ? this.serverApps.engineVersion === '27.5.2' : this.updatedNginx;
    return rememberAppPlan({ ...await calculateUpdatePlan(), appId: id, operation, packages: operation !== 'update' || !updated ? [{ name: id === 'docker' ? 'docker.io' : 'nginx', fromVersion: id === 'docker' ? this.serverApps.engineVersion : '1.24.0', toVersion: id === 'docker' ? '27.5.2' : '1.24.1', security: false, downloadBytes: 24000000, installedDeltaBytes: 1200000 }] : [], downloadBytes: operation === 'update' && !updated ? 24000000 : 0 }, (clean) => { if (operation === 'uninstall') { this.removedApps.add(id); if (clean) cleanAppFiles(id); } else { this.removedApps.delete(id); appFileFixtures(id); if (operation === 'update') { if (id === 'docker') this.serverApps.engineVersion = '27.5.2'; else this.updatedNginx = true; } } });
  }
  private updatedGit = false;
  private updatedNginx = false;
  private serverApps = new MockServerApps();
  getDockerResources() { return this.serverApps.getDockerResources(); }
  runDockerResourceAction(request: DockerResourceRequest) { return this.serverApps.runDockerResourceAction(request); }
  getContainers() { return this.serverApps.getContainers(); }
  getContainer(id: string) { return this.serverApps.getContainer(id); }
  getContainerLogs(id: string) { return this.serverApps.getContainerLogs(id); }
  runContainerAction(id: string, action: ContainerAction, revision: string) { return this.serverApps.runContainerAction(id, action, revision); }
  getWebsites() { return this.serverApps.getWebsites(); }
  getWebsiteLogs(kind: 'access' | 'error') { return this.serverApps.getWebsiteLogs(kind); }
  saveWebsite(id: string, definition: WebsiteDefinition, revision: string) { return this.serverApps.saveWebsite(id, definition, revision); }
  private settings: SystemSettings = {
    hostname: 'atlas', runtimeHostname: 'atlas.lan', timezone: 'Etc/UTC',
    ntp: true, canNtp: true, ntpSynchronized: true, serverTime: '', revision: 'mock-0',
  };
  private settingsRevision = 0;
  readonly kind = 'mock' as const;
  readonly capabilities: SourceCapabilities = {
    isLive: false,
    canServiceActions: true,
    canTerminal: true,
    canPowerControl: true,
    canConfigureNetwork: false,
  };

  async login(username: string): Promise<SessionUser> {
    return { name: username, home: '/home/user' };
  }

  async logout(): Promise<void> {}

  async getSession(): Promise<SessionUser | null> {
    return null;
  }

  async reauth(): Promise<void> {}

  onSessionExpired(): Unsubscribe {
    return () => {};
  }

  async getIdentity(): Promise<SystemIdentity> {
    const overview = getOverview();
    return {
      hostname: this.settings.runtimeHostname,
      os: overview.os,
      kernel: overview.kernel,
      architecture: 'x86_64',
      cpuModel: 'AMD EPYC 7763 64-Core Processor',
      bootId: 'mock',
      serverTime: new Date().toISOString(),
    };
  }

  async listProcesses() {
    return [
      { pid: 1, name: 'systemd', user: 'root', state: 'S', cpuPercent: 0.1, memoryBytes: 12582912 },
      { pid: 482, name: 'lumod', user: 'demo', state: 'R', cpuPercent: 2.4, memoryBytes: 48234496 },
      { pid: 719, name: 'nginx', user: 'www-data', state: 'S', cpuPercent: 0.8, memoryBytes: 24117248 },
    ];
  }

  async getOverview(): Promise<SystemOverview> {
    return { ...getOverview(), hostname: this.settings.runtimeHostname };
  }

  async getSystemSettings(): Promise<SystemSettings> {
    return { ...this.settings, serverTime: new Date().toISOString() };
  }

  async getTimezones(): Promise<string[]> {
    return ['Etc/UTC', ...Intl.supportedValuesOf('timeZone')];
  }

  async updateSystemSettings(change: SystemSettingsChange, expectedRevision: string): Promise<SystemSettings> {
    if (expectedRevision !== this.settings.revision) {
      throw new ApiError('stale_revision', 'The system settings changed.', {});
    }
    this.settings = { ...this.settings, ...change, revision: `mock-${++this.settingsRevision}` };
    if ('ntp' in change) this.settings.ntpSynchronized = change.ntp;
    return this.getSystemSettings();
  }

  onIdentityChanged(): Unsubscribe {
    return () => {};
  }

  async runPowerAction(action: PowerAction): Promise<PowerSchedule> {
    return {
      action: `system.${action}`,
      scheduledAt: new Date(Date.now() + 5000).toISOString(),
    };
  }

  async getNetworkSnapshot(): Promise<NetworkSnapshot> {
    return {
      dnsServers: ['1.1.1.1'],
      dnsSource: 'resolved',
      interfaces: [
        {
          name: 'eth0',
          hardwareAddress: '02:42:ac:11:00:02',
          addresses: ['192.0.2.10/24', '2001:db8::10/64'],
          gateways: ['192.0.2.1'],
          dnsServers: ['192.0.2.53'],
          up: true,
          loopback: false,
        },
      ],
    };
  }

  async applyNetworkConfig(
    _config: NetworkConfig,
    expectedRevision: string,
    confirmTimeoutSec = 90,
  ): Promise<PendingNetworkChange> {
    return {
      token: 'a'.repeat(64),
      previousRevision: expectedRevision,
      expiresAt: new Date(Date.now() + confirmTimeoutSec * 1000).toISOString(),
      confirmTimeoutSec,
    };
  }

  async confirmNetworkConfig(token: string): Promise<NetworkConfirmation> {
    return {
      token,
      confirmed: true,
    };
  }

  uptimeSeconds(): number {
    return uptimeSeconds();
  }

  sampleLoad(): LoadSample {
    return sampleLoad();
  }

  subscribeMetrics(onSample: (sample: LoadSample) => void, intervalMs = TICK_MS): Unsubscribe {
    const id = window.setInterval(() => onSample(sampleLoad()), intervalMs);
    return () => window.clearInterval(id);
  }

  async listServices(): Promise<ServiceUnit[]> {
    return listServices();
  }

  async getServiceDetail(name: string): Promise<ServiceDetail> {
    return getServiceDetail(name);
  }

  subscribeServices(onChange: (units: ServiceUnit[]) => void): Unsubscribe {
    return subscribeServices(() => onChange(listServices()));
  }

  runServiceAction(name: string, action: ServiceAction): Promise<ServiceUnit> {
    return runServiceAction(name, action);
  }

  async queryJournal(query: JournalQuery = {}): Promise<JournalPage> {
    let entries = seedLogLines(query.limit ?? 40);
    if (query.unit) entries = entries.filter((line) => line.unit === query.unit);
    if (query.priority) entries = entries.filter((line) => line.priority === query.priority);
    if (query.since) {
      const since = Date.parse(query.since);
      if (Number.isFinite(since)) entries = entries.filter((line) => line.timestamp >= since);
    }
    if (query.boot === 'previous') {
      entries = entries.map((line) => ({ ...line, bootId: 'mock-previous-boot', fields: { ...line.fields, _BOOT_ID: 'mock-previous-boot' } }));
    }
    return { entries, nextCursor: null };
  }

  streamJournal(onEntry: (entry: LogLine) => void): Unsubscribe {
    const id = window.setInterval(() => onEntry(makeLogLine()), TICK_MS);
    return () => window.clearInterval(id);
  }

  async listJournalUnits(): Promise<string[]> {
    return [...LOG_UNITS];
  }

  async listSkills(): Promise<SkillCatalog> { return { path: '/home/user/.agents/skills', skills: await Promise.all(mockSkills.filter((skill) => getEntry(skill.path.split('/'))).map((skill) => this.readSkill(skill.id))), limited: false }; }
  async readSkill(id: string): Promise<SkillDetail> {
    const skill = mockSkills.find((item) => item.id === id);
    const raw = skill && getEntry(skill.path.split('/'))?.content;
    if (!skill || raw === undefined) throw new Error('Skill no longer exists. Refresh the list.');
    const header = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const field = (name: string) => header?.[1].match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1].trim().replace(/^['"]|['"]$/g, '') ?? '';
    const name = field('name'), description = field('description');
    return { ...skill, name: name || skill.id, description, raw, body: header ? raw.slice(header[0].length) : raw, issue: name && description ? undefined : 'The YAML header needs a name and description.' };
  }

  private folderBase = '/home/user';
  private folderRevision = 0;
  private folderPaths: Record<string, string | null> = {};

  async getFileLocationSettings(): Promise<FileLocationSettings> {
    const names = [['desktop', 'Desktop'], ['documents', 'Documents'], ['download', 'Downloads'], ['pictures', 'Pictures'], ['music', 'Music'], ['videos', 'Videos'], ['templates', 'Templates'], ['publicshare', 'Public']];
    return { revision: String(this.folderRevision), choices: [{ id: 'home', name: 'Home', path: '/home/user' }, { id: 'data', name: 'Data storage', path: '/data' }].filter((choice) => getEntry(choice.path.split('/'))?.kind === 'dir'), locations: names.map(([id, name]) => {
      const path = this.folderPaths[id] ?? `${this.folderBase === '/' ? '' : this.folderBase}/${name}`;
      return { id, name, path, defaultPath: `/home/user/${name}`, exists: getEntry(path.split('/'))?.kind === 'dir', enabled: this.folderPaths[id] !== null };
    }) };
  }

  async listFileLocations(): Promise<FileLocation[]> {
    return (await this.getFileLocationSettings()).locations.filter((item) => item.exists && item.enabled);
  }

  async planFileLocationMove(base: string, revision: string, id?: string): Promise<{ files: number; bytes: number; create: number }> {
    if (revision !== String(this.folderRevision)) throw new ApiError('stale_revision', 'Folder locations changed. Refresh and try again.');
    const parent = id ? base.slice(0, base.lastIndexOf('/')) || '/' : base;
    if (!base.startsWith('/') || /[\x00\r\n]/.test(base) || getEntry(parent === '/' ? [''] : parent.split('/'))?.kind !== 'dir') throw new ApiError('validation_failed', 'Choose an existing parent folder.');
    let files = 0, bytes = 0, create = 0;
    const count = (entry: FsEntry) => { if (entry.kind === 'file') { files++; bytes += entry.size; } else entry.children?.forEach(count); };
    for (const item of (await this.getFileLocationSettings()).locations) {
      if (id && item.id !== id) continue;
      const target = id ? base : `${base === '/' ? '' : base}/${item.name}`;
      if (!getEntry(target.split('/'))) create++;
      if (target === item.path) continue;
      if (base === item.path || base.startsWith(`${item.path}/`)) throw new ApiError('validation_failed', 'Choose a parent outside the folders being moved.');
      const destination = getEntry(target.split('/'));
      if (destination && destination.kind !== 'dir') throw new ApiError('validation_failed', `${item.name} already exists and is not a folder.`);
      if (!item.enabled) continue;
      for (const entry of getEntry(item.path.split('/'))?.children ?? []) {
        if (destination?.children?.some((child) => child.name === entry.name)) throw new ApiError('conflict', `${entry.name} already exists. Nothing was moved.`);
        count(entry);
      }
    }
    return { files, bytes, create };
  }

  async setFileLocation(id: string, path: string, revision: string, remove = false): Promise<FileLocationSettings> {
    if (revision !== String(this.folderRevision)) throw new ApiError('stale_revision', 'Folder locations changed. Refresh and try again.');
    const item = (await this.getFileLocationSettings()).locations.find((item) => item.id === id);
    if (!item) throw new ApiError('validation_failed', 'Unknown standard folder.');
    if (remove) {
      if (item.enabled && item.exists) await this.deleteFile(item.path.split('/'));
      this.folderPaths[id] = null;
    } else {
      await this.planFileLocationMove(path, revision, id);
      const destination = path.split('/');
      if (!getEntry(destination)) mockCreateEntry(destination, 'directory');
      if (item.enabled && path !== item.path) for (const entry of [...(getEntry(item.path.split('/'))?.children ?? [])]) moveEntry([...item.path.split('/'), entry.name], [...destination, entry.name]);
      this.folderPaths[id] = path;
    }
    this.folderRevision++;
    return this.getFileLocationSettings();
  }

  async setFileLocationBase(base: string, revision: string): Promise<FileLocationSettings> {
    base = base.replace(/\/+$/, '') || '/';
    await this.planFileLocationMove(base, revision);
    const settings = await this.getFileLocationSettings();
    for (const item of settings.locations) {
      const destination = `${base === '/' ? '' : base}/${item.name}`.split('/');
      if (!getEntry(destination)) mockCreateEntry(destination, 'directory');
      if (this.absolutePath(destination) === item.path) continue;
      for (const entry of [...(getEntry(item.path.split('/'))?.children ?? [])]) moveEntry([...item.path.split('/'), entry.name], [...destination, entry.name]);
    }
    this.folderPaths = {};
    this.folderBase = base;
    this.folderRevision++;
    return this.getFileLocationSettings();
  }

  homePath(): string[] {
    return mockHomePath();
  }

  async listDir(path: string[]): Promise<FsEntry[]> {
    return mockListDir(path);
  }

  absolutePath(path: string[]): string { return path[0] === '' ? path.join('/') || '/' : `/home/${path.join('/')}`; }

  async createEntry(path: string[], kind: 'file' | 'directory'): Promise<void> { mockCreateEntry(path, kind); }

  async readFile(path: string[]): Promise<FileRead> {
    const entry = getEntry(path);
    if (!entry || entry.kind !== 'file') {
      throw new ApiError('not_found', 'No such file.');
    }
    return {
      content: entry.content ?? null,
      contentBase64: entry.content != null ? textToBase64(entry.content) : null,
      revision: entryRevision(path),
      truncated: false,
      sizeBytes: entry.size,
    };
  }

  readSystemFile(path: string): Promise<FileRead> {
    return readSystemFile(path);
  }

  async writeFile(path: string[], contentBase64: string, expectedRevision: string | null): Promise<FileWrite> {
    return writeEntry(path, base64ToText(contentBase64), expectedRevision);
  }

  writePrivilegedFile(
    path: string,
    contentBase64: string,
    expectedRevision: string,
    restartUnit?: string,
  ): Promise<PrivilegedFileWrite> {
    return writePrivilegedFile(path, contentBase64, expectedRevision, restartUnit);
  }

  async listTrash(): Promise<TrashItem[]> { return listTrashed(); }
  async restoreTrash(item: TrashSelection): Promise<string> { return restoreTrashed(item); }
  async deleteTrash(items: TrashSelection[]): Promise<void> { removeTrashed(items); }
  async moveFile(from: string[], to: string[]): Promise<void> { moveEntry(from, to); }
  async deleteFile(path: string[]): Promise<void> {
    deleteEntry(path);
  }

  getAppUpdateHistory = getAppUpdateHistory;

  getPackageCatalog() { return getPackageCatalog(); }

  refreshUpdates(): Promise<string> {
    return refreshUpdates();
  }

  calculateUpdatePlan(): Promise<UpdatePlan> {
    return calculateUpdatePlan();
  }

  applyUpdatePlan(planId: string, clean = false): Promise<string> {
    return applyUpdatePlan(planId, clean);
  }

  subscribeUpdateProgress(requestId: string, onProgress: (progress: UpdateProgress) => void): Unsubscribe {
    return subscribeUpdateProgress(requestId, onProgress);
  }

  openTerminal(opts: TerminalOpenOptions, handlers: TerminalHandlers): TerminalSession {
    return new MockTerminalSession(opts, handlers);
  }
}
