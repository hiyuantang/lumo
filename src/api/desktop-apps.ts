// SPDX-License-Identifier: AGPL-3.0-only
export interface DesktopManifest {
  icon?: string; iconImage?: string;
  schemaVersion: 1; id: string; name: string; version: string; description: string;
  license: 'AGPL-3.0-only'; apiVersion: 1; entry: string; styles: string;
  window: { width: number; height: number; minWidth: number; minHeight: number };
  capabilities: { name: 'system.metrics.read' | 'app.storage' | 'notifications.send' }[];
}
export interface DesktopBuild { manifest: DesktopManifest; digest: string }
export interface DesktopApp extends DesktopBuild { revision: string; enabled: boolean; previous?: string; history: { from: string; to: string; at: string }[] }
export interface DesktopCatalog { apps: DesktopApp[]; builds: DesktopBuild[] }
export interface DesktopChange { requestId: string; action: 'install' | 'restore' | 'disable' | 'enable' | 'uninstall'; id: string; digest?: string; revision: string; clean?: boolean }
export interface DesktopLaunch { token: string; handshake: string; url?: string; document?: string }
export interface DesktopMetrics { cpuPercent: number; memoryUsedBytes: number; memoryTotalBytes: number; at: number }

export type DesktopJSON = null | boolean | number | string | DesktopJSON[] | { [key: string]: DesktopJSON };
export interface DesktopData { revision: string; value: DesktopJSON }
