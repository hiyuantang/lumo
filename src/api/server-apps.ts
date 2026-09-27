// SPDX-License-Identifier: AGPL-3.0-only
export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  project: string;
}

export interface ContainerSnapshot {
  status: 'ready' | 'not-installed' | 'stopped' | 'permission-denied' | 'unavailable';
  message: string;
  version: string;
  containers: Container[];
}

export interface ContainerDetail extends Container {
  revision: string;
  created: string;
  startedAt: string;
  exitCode: number;
  ports: { container: string; address: string; host: string }[];
  mounts: { type: string; source: string; destination: string; writable: boolean }[];
}

export type ContainerAction = 'start' | 'stop' | 'restart';
export interface AppLogs { text: string; truncated: boolean }

export interface WebsiteDefinition {
  domain: string;
  kind: 'static' | 'proxy';
  port: number;
  root: string;
  enabled: boolean;
}

export interface Website {
  id: string;
  path: string;
  name: string;
  source: string;
  revision: string;
  managed: boolean;
  definition?: WebsiteDefinition;
}

export interface WebsiteSnapshot { installed: boolean; sites: Website[]; warnings: string[] }
export interface WebsiteResult { site: Website; rollbackRef: string; reloaded: boolean }

export type ServerAppID = 'docker' | 'nginx';
export type LibraryAppID = ServerAppID | 'opencode';
export type AppOperation = 'install' | 'uninstall';
export interface AppCatalog { canInstall: boolean; apps: { id: LibraryAppID; installed: boolean; canUninstall?: boolean }[] }
