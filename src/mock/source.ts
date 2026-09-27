// SPDX-License-Identifier: AGPL-3.0-only
import { mockSkills } from './skills';
import type { SkillCatalog, SkillDetail } from '../api/skills';
import type { TrashItem, TrashSelection } from '../api/trash';
import { base64ToText, textToBase64 } from '../api/encoding';
import type {
  DataSource,
  FileRead,
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
import type { DockerResourceRequest, AppOperation, AppCatalog, ContainerAction, ServerAppID, WebsiteDefinition } from '../api/server-apps';
import {
  deleteEntry, listTrashed, restoreTrashed, removeTrashed,
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
  subscribeUpdateProgress,
} from './updates';

const TICK_MS = 2000;

export class MockDataSource implements DataSource {
  async getAppCatalog(): Promise<AppCatalog> { return { canInstall: true, apps: [{ id: 'docker', installed: true }, { id: 'nginx', installed: true }] }; }
  async uninstallOpenCode(): Promise<void> {}
  async planAppInstall(id: ServerAppID, operation: AppOperation = 'install'): Promise<UpdatePlan> {
    const updated = id === 'docker' ? this.serverApps.engineVersion === '27.5.2' : this.updatedNginx;
    return rememberAppPlan({ ...await calculateUpdatePlan(), appId: id, operation, packages: operation === 'update' && !updated ? [{ name: id === 'docker' ? 'docker.io' : 'nginx', fromVersion: id === 'docker' ? this.serverApps.engineVersion : '1.24.0', toVersion: id === 'docker' ? '27.5.2' : '1.24.1', security: false, downloadBytes: 24000000, installedDeltaBytes: 1200000 }] : [], downloadBytes: operation === 'update' && !updated ? 24000000 : 0 }, () => { if (operation === 'update') { if (id === 'docker') this.serverApps.engineVersion = '27.5.2'; else this.updatedNginx = true; } });
  }
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
  async deleteFile(path: string[]): Promise<void> {
    deleteEntry(path);
  }

  getAppUpdateHistory = getAppUpdateHistory;

  refreshUpdates(): Promise<string> {
    return refreshUpdates();
  }

  calculateUpdatePlan(): Promise<UpdatePlan> {
    return calculateUpdatePlan();
  }

  applyUpdatePlan(planId: string): Promise<string> {
    return applyUpdatePlan(planId);
  }

  subscribeUpdateProgress(requestId: string, onProgress: (progress: UpdateProgress) => void): Unsubscribe {
    return subscribeUpdateProgress(requestId, onProgress);
  }

  openTerminal(opts: TerminalOpenOptions, handlers: TerminalHandlers): TerminalSession {
    return new MockTerminalSession(opts, handlers);
  }
}
