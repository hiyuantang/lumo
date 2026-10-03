// SPDX-License-Identifier: AGPL-3.0-only
export interface NativeManifest {
  required?: boolean; provider?: boolean; assistant?: boolean; schemaVersion: number; hostApiVersion: number; id: string; name: string; description?: string; version: string; license: string;
  icon: string; window: { width: number; height: number; minWidth: number; minHeight: number };
  entry: string; styles?: string; background?: string; requiredPackage?: 'git' | 'docker' | 'nginx'; permissions?: string[];
  backend?: { resident?: boolean; contributions?: ('software' | 'history')[]; maxBodyBytes?: number; runtime?: 'node'; entry: string; platform: string; protocolVersion: number; routes: string[] };
  pi?: { entry: string; setting: string; readTools: string[]; writeTools: string[] };
}
export interface NativeRelease { digest: string; manifest: NativeManifest }
export interface NativeApp { name: string; installed: boolean; current?: NativeRelease; releases: NativeRelease[]; revision: string; previous?: string; history: { from: string; to: string; at: string }[]; error?: string }
export interface NativeBundle { name: string; manifest: NativeManifest; files: Record<string, string> }
export interface NativeChange { requestId: string; name: string; action: 'install' | 'update' | 'rollback' | 'uninstall'; digest: string; revision: string; trust: boolean; clean?: boolean }

export interface AssistantRequest { action: 'new' | 'workspace'; id: string }
