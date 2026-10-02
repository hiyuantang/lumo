// SPDX-License-Identifier: AGPL-3.0-only
import type { DesktopCatalog, DesktopChange, DesktopApp, DesktopLaunch, DesktopMetrics } from './desktop-apps';
import type { CalendarSnapshot, CalendarChange, CalendarItem, CalendarGoogleStatus, CalendarGoogleConfig, CalendarGoogleAction, CalendarGoogleResult, CalendarNotice } from './calendar';
import type { DesktopRequest, PiExtensionSettings } from './lumo-use';
import type { GitSnapshot, GitDiff, GitAction } from './git';
import type { PiImageSettings, PiTemplate, PiConversationReference, PiCompaction, PiCompactionChange, PiProvider, PiConnection, PiAuthMethod, PiAuthState, PiInstruction, PiInstructionKind, PiArchivedSession, PiSession, PiCommand, PiReply, PiEvents, PiAnswer, PiPermissionMode, PiStart } from './pi';
import type { SkillCatalog, SkillDetail } from './skills';
import type { TrashItem, TrashSelection } from './trash';
import { LiveDataSource } from './client';
import { ApiError } from './transport';
import { MockDataSource } from '../mock/source';
import type { DockerResources, DockerResourceRequest, AppOperation, AppCatalog, AppLogs, ContainerAction, ContainerDetail, ContainerSnapshot, LibraryAppID, WebsiteDefinition, WebsiteResult, WebsiteSnapshot } from './server-apps';

export type ServiceState = 'active' | 'inactive' | 'failed';
export type ServiceAction = 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable';
export type PowerAction = 'reboot' | 'poweroff';

export interface PowerSchedule {
  action: `system.${PowerAction}`;
  scheduledAt: string;
}

export interface SystemSettings {
  hostname: string;
  runtimeHostname: string;
  timezone: string;
  ntp: boolean;
  canNtp: boolean;
  ntpSynchronized: boolean;
  serverTime: string;
  revision: string;
}

export type SystemSettingsChange = { timezone: string } | { ntp: boolean };

export interface NetworkRoute {
  to: string;
  via: string;
  metric?: number;
}

export interface NetworkNameservers {
  addresses?: string[];
  search?: string[];
}

export interface EthernetConfig {
  dhcp4: boolean;
  dhcp6: boolean;
  addresses?: string[];
  nameservers?: NetworkNameservers;
  routes?: NetworkRoute[];
  optional?: boolean;
}

export interface NetworkConfig {
  version: 2;
  ethernets: Record<string, EthernetConfig>;
}

export interface NetworkInterface {
  name: string;
  hardwareAddress?: string;
  addresses: string[];
  up: boolean;
  loopback: boolean;
  gateways?: string[] | null;
  dnsServers?: string[] | null;
}

export interface NetworkSnapshot {
  revision?: string;
  interfaces: NetworkInterface[];
  dnsServers?: string[] | null;
  dnsSource?: 'resolved' | 'resolv.conf';
}

export interface PendingNetworkChange {
  token: string;
  previousRevision: string;
  expiresAt: string;
  confirmTimeoutSec: number;
}

export interface NetworkConfirmation {
  token: string;
  confirmed: true;
}

export interface ServiceUnit {
  name: string;
  description: string;
  state: ServiceState;
  enabled: boolean;
  pid: number | null;
  memoryMb: number;
  since: string;
}

export interface ServiceDependency {
  name: string;
  relation: 'requires' | 'wants';
}

export interface ServiceUnitFile {
  path: string;
  content: string | null;
  override: boolean;
  error: string | null;
}

export interface ServiceDetail {
  name: string;
  documentation: string[];
  dependencies: ServiceDependency[];
  files: ServiceUnitFile[];
}

export interface SystemAlert {
  id: string;
  level: 'info' | 'warning' | 'critical';
  text: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  user: string;
  state: string;
  cpuPercent: number | null;
  memoryBytes: number;
}

export interface SystemOverview {
  hostname: string;
  os: string;
  kernel: string;
  bootedAt: number;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  storageUsedGb: number;
  storageTotalGb: number;
  pendingUpdates: number;
  securityUpdates: number;
  alerts: SystemAlert[];
  cpuHistory: number[];
  cpuCores: number;
  cpuPerCore: { id: number; usagePercent: number | null }[];
  cpuLoad: number[];
  network: { interface: string; rxBytesPerSec: number; txBytesPerSec: number }[];
}

export interface FileLocationSettings {
  locations: (FileLocation & { defaultPath: string; exists: boolean; enabled: boolean })[];
  choices: FileLocation[];
  revision: string;
}

export interface FileLocation {
  id: string;
  name: string;
  path: string;
}

export interface SystemIdentity {
  hostname: string;
  os: string;
  kernel: string;
  architecture: string;
  cpuModel?: string;
  bootId: string;
  serverTime: string;
}

export interface LoadSample {
  cpuPercent: number;
  netDownKbps: number;
  netUpKbps: number;
}

export type LogPriority = 'err' | 'warning' | 'info' | 'debug';

export interface LogLine {
  id: number;
  timestamp: number;
  priority: LogPriority;
  priorityCode: 3 | 4 | 6 | 7;
  unit: string;
  message: string;
  pid: number;
  hostname: string;
  bootId: string;
  fields: Record<string, string>;
}

export type JournalBoot = 'current' | 'previous';

export interface JournalQuery {
  unit?: string;
  priority?: LogPriority;
  since?: string;
  boot?: JournalBoot;
  limit?: number;
  after?: string;
}

export interface JournalPage {
  entries: LogLine[];
  nextCursor: string | null;
}

export interface FsEntry {
  name: string;
  kind: 'dir' | 'file';
  size: number;
  modified: string;
  modifiedAt?: string;
  mode?: string;
  symlinkTarget?: string | null;
  content?: string;
  children?: FsEntry[];
}

export interface FileRead {
  content: string | null;
  contentBase64: string | null;
  revision: string | null;
  truncated: boolean;
  sizeBytes: number;
}

export interface FileWrite {
  revision: string;
  sizeBytes: number;
}

export interface PrivilegedFileWrite extends FileWrite {
  rollbackRef: string;
  validation: { kind: string; checked: boolean };
  restart: { success: boolean; error?: string } | null;
}

export type PackageGroup = 'system' | 'third-party' | 'unknown';

export interface InstalledPackage {
  name: string;
  version: string;
  architecture: string;
  summary: string;
  group: PackageGroup;
  origin: string;
  held: boolean;
  updateVersion?: string;
  updateGroup?: PackageGroup;
  updateOrigin?: string;
  security: boolean;
}

export interface PackageCatalog {
  updateError?: string;
  packages: InstalledPackage[];
  checkedAt: string;
  rebootRequired: boolean;
}

export interface UpdatePackage {
  name: string;
  fromVersion: string;
  toVersion: string;
  security: boolean;
  downloadBytes: number;
  installedDeltaBytes: number;
}

export interface UpdatePlan {
  appId?: LibraryAppID;
  operation?: AppOperation;
  id: string;
  createdAt: string;
  expiresAt: string;
  packages: UpdatePackage[];
  securityCount: number;
  downloadBytes: number;
  installedDeltaBytes: number;
  rebootRequired: boolean;
}

export interface AppUpdateHistoryEntry {
  requestId: string;
  appId: LibraryAppID;
  completedAt: string;
  success: boolean;
  error?: string;
  packages: UpdatePackage[];
}

export interface UpdateProgress {
  requestId: string;
  planId: string;
  phase: string;
  percent: number;
  message: string;
  done: boolean;
  success: boolean;
  error?: string;
  updatedAt: string;
}

export interface TerminalOpenOptions {
  program?: 'pi';
  directory?: string;
  cols: number;
  rows: number;
  user?: string;
}

export interface TerminalHandlers {
  onData(data: string): void;
  onExit(code: number): void;
  onError?(err: Error): void;
  onReset?(): void;
}

export interface TerminalSession {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface SourceCapabilities {
  isLive: boolean;
  canServiceActions: boolean;
  canTerminal: boolean;
  canPowerControl: boolean;
  canConfigureNetwork: boolean;
}

export interface SessionUser {
  name: string;
  uid?: number;
  gid?: number;
  home?: string;
}

export type Unsubscribe = () => void;

export interface DataSource {
  desktopApps(): Promise<DesktopCatalog>;
  desktopAppChange(change: DesktopChange): Promise<DesktopApp>;
  desktopAppLaunch(digest: string, preview: boolean): Promise<DesktopLaunch>;
  desktopAppCall(token: string, method: string): Promise<DesktopMetrics>;
  desktopAppReport(token: string, status: 'ready' | 'error', message: string): Promise<void>;
  desktopAppClose(token: string): Promise<void>;
  calendarSnapshot(from: string, to: string, includeGoogle?: boolean): Promise<CalendarSnapshot>;
  calendarChange(change: CalendarChange): Promise<CalendarItem>;
  calendarGoogleStatus(): Promise<CalendarGoogleStatus>;
  calendarGoogle(action: CalendarGoogleAction, config?: CalendarGoogleConfig): Promise<CalendarGoogleResult>;
  calendarNotices(): Promise<CalendarNotice[]>;
  gitRepository(path: string): Promise<GitSnapshot>;
  gitDiff(path: string, file: string, commit: string, staged: boolean): Promise<GitDiff>;
  gitAction(request: GitAction): Promise<void>;
  piTemplates(): Promise<PiTemplate[]>;
  piSaveTemplate(template: Pick<PiTemplate, 'name' | 'content' | 'revision'>, remove?: boolean): Promise<void>;
  piUploadImage(content: string): Promise<{ path: string }>;
  piProviders(): Promise<{ providers: PiProvider[] }>;
  piConnections(): Promise<{ providers: PiConnection[] }>;
  piAuthStart(provider: string, method: PiAuthMethod, operation: 'login' | 'logout'): Promise<PiAuthState>;
  piAuthState(id: string): Promise<PiAuthState>;
  piAuthReply(id: string, promptId: string, value: string): Promise<void>;
  piAuthCancel(id: string): Promise<void>;
  piReference(project: string, session: string): Promise<Omit<PiConversationReference, 'name'>>;
  piCompaction(model: string): Promise<PiCompaction>;
  piSaveCompaction(change: PiCompactionChange): Promise<PiCompaction>;
  piImageSettings(): Promise<PiImageSettings>;
  piSaveImageSettings(change: PiImageSettings): Promise<PiImageSettings>;
  piSettings(kind: PiInstructionKind): Promise<PiInstruction>;
  piSaveSettings(kind: PiInstructionKind, content: string, revision: string): Promise<PiInstruction>;
  piSessions(project: string): Promise<PiSession[]>;
  piDeleteSession(project: string, session: string): Promise<void>;
  piArchivedSessions(): Promise<PiArchivedSession[]>;
  piArchiveSession(project: string, session: string): Promise<void>;
  piRestoreSession(project: string, session: string): Promise<void>;
  piStart(project: string, session?: string, resume?: string, permissionMode?: PiPermissionMode, rememberPermissionMode?: boolean): Promise<PiStart>;
  piCommand(id: string, command: PiCommand): Promise<PiReply>;
  piAnswer(id: string, answer: PiAnswer, requestId: string): Promise<void>;
  piEvents(id: string, after: number): Promise<PiEvents>;
  piExtensions(): Promise<PiExtensionSettings>;
  piSaveExtensions(value: PiExtensionSettings): Promise<PiExtensionSettings>;
  piDesktopClaim(id: string, desktopId: string): Promise<DesktopRequest>;
  piDesktopResult(id: string, desktopId: string, text: string, error: boolean): Promise<void>;
  piStop(id: string): Promise<void>;
  listSkills(): Promise<SkillCatalog>;
  readSkill(id: string): Promise<SkillDetail>;
  getAppCatalog(): Promise<AppCatalog>;
  uninstallPi(clean?: boolean): Promise<void>;
  planAppInstall(id: LibraryAppID, operation?: AppOperation): Promise<UpdatePlan>;
  getDockerResources(): Promise<DockerResources>;
  runDockerResourceAction(request: DockerResourceRequest): Promise<void>;
  getContainers(): Promise<ContainerSnapshot>;
  getContainer(id: string): Promise<ContainerDetail>;
  getContainerLogs(id: string): Promise<AppLogs>;
  runContainerAction(id: string, action: ContainerAction, revision: string): Promise<ContainerDetail>;
  getWebsites(): Promise<WebsiteSnapshot>;
  getWebsiteLogs(kind: 'access' | 'error'): Promise<AppLogs>;
  saveWebsite(id: string, definition: WebsiteDefinition, revision: string): Promise<WebsiteResult>;
  readonly kind: 'mock' | 'live';
  readonly capabilities: SourceCapabilities;

  login(username: string, password: string): Promise<SessionUser>;
  logout(): Promise<void>;
  getSession(): Promise<SessionUser | null>;
  reauth(password: string): Promise<void>;
  onSessionExpired(listener: () => void): Unsubscribe;

  getIdentity(): Promise<SystemIdentity>;
  onIdentityChanged(listener: (hostname: string) => void): Unsubscribe;
  getSystemSettings(): Promise<SystemSettings>;
  getTimezones(): Promise<string[]>;
  updateSystemSettings(change: SystemSettingsChange, expectedRevision: string): Promise<SystemSettings>;
  getOverview(): Promise<SystemOverview>;
  listProcesses(): Promise<ProcessInfo[]>;
  uptimeSeconds(): number;
  sampleLoad(): LoadSample;
  subscribeMetrics(onSample: (sample: LoadSample) => void, intervalMs?: number): Unsubscribe;
  runPowerAction(action: PowerAction): Promise<PowerSchedule>;
  getNetworkSnapshot(): Promise<NetworkSnapshot>;
  applyNetworkConfig(config: NetworkConfig, expectedRevision: string, confirmTimeoutSec?: number): Promise<PendingNetworkChange>;
  confirmNetworkConfig(token: string): Promise<NetworkConfirmation>;

  listServices(): Promise<ServiceUnit[]>;
  getServiceDetail(name: string): Promise<ServiceDetail>;
  subscribeServices(onChange: (units: ServiceUnit[]) => void): Unsubscribe;
  runServiceAction(name: string, action: ServiceAction, expectedActiveState?: string): Promise<ServiceUnit>;

  queryJournal(query?: JournalQuery): Promise<JournalPage>;
  streamJournal(onEntry: (entry: LogLine) => void, onError?: (err: Error) => void): Unsubscribe;
  listJournalUnits(): Promise<string[]>;

  listFileLocations(): Promise<FileLocation[]>;
  getFileLocationSettings(): Promise<FileLocationSettings>;
  planFileLocationMove(path: string, revision: string, id?: string): Promise<{ files: number; bytes: number; create: number }>;
  setFileLocation(id: string, path: string, revision: string, remove?: boolean): Promise<FileLocationSettings>;
  setFileLocationBase(path: string, revision: string): Promise<FileLocationSettings>;
  homePath(): string[];
  absolutePath(path: string[]): string;
  createEntry(path: string[], kind: 'file' | 'directory'): Promise<void>;
  listDir(path: string[]): Promise<FsEntry[]>;
  readFile(path: string[], preview?: 'image'): Promise<FileRead>;
  readSystemFile(path: string, preview?: 'image'): Promise<FileRead>;
  writeFile(path: string[], contentBase64: string, expectedRevision: string | null): Promise<FileWrite>;
  writePrivilegedFile(path: string, contentBase64: string, expectedRevision: string, restartUnit?: string): Promise<PrivilegedFileWrite>;
  listTrash(): Promise<TrashItem[]>;
  restoreTrash(item: TrashSelection): Promise<string>;
  deleteTrash(items: TrashSelection[]): Promise<void>;
  deleteFile(path: string[]): Promise<void>;
  moveFile(from: string[], to: string[]): Promise<void>;

  getPackageCatalog(): Promise<PackageCatalog>;
  refreshUpdates(): Promise<string>;
  getAppUpdateHistory(): Promise<AppUpdateHistoryEntry[]>;
  calculateUpdatePlan(): Promise<UpdatePlan>;
  applyUpdatePlan(planId: string, clean?: boolean): Promise<string>;
  subscribeUpdateProgress(requestId: string, onProgress: (progress: UpdateProgress) => void, onError?: (err: Error) => void): Unsubscribe;

  openTerminal(opts: TerminalOpenOptions, handlers: TerminalHandlers): TerminalSession;
}

export function isReauthRequired(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'forbidden' && err.details.reauthRequired === true;
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'unauthorized':
        return 'Session expired. Log in again.';
      case 'forbidden':
        return 'Action not permitted.';
      case 'not_found':
        return 'Item no longer exists.';
      case 'conflict':
      case 'stale_revision':
        return 'Changed on the server. Refresh and try again.';
      case 'busy':
        return 'Server busy. Try again.';
      case 'unavailable':
        return 'Server unreachable.';
      default:
        return err.message || 'Something went wrong.';
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

function liveModeEnabled(): boolean {
  const flag = import.meta.env.VITE_LUMO_LIVE as string | undefined;
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  return import.meta.env.PROD;
}

const dataSource: DataSource = liveModeEnabled() ? new LiveDataSource() : new MockDataSource();

export function getDataSource(): DataSource {
  return dataSource;
}
