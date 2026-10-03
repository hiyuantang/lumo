// SPDX-License-Identifier: AGPL-3.0-only
import { pluginPackages, pluginBases, type PluginId } from './plugins';

export interface PluginManifest { schemaVersion: number; hostApiVersion: number; id: string; version: string; entry: string; styles?: string; background?: string }
export const pluginAsset = /^[a-f0-9]{64}\.(js|css)$/;

export async function readPluginManifest(id: PluginId, signal?: AbortSignal): Promise<PluginManifest> {
  const response = await fetch(`${pluginBases[id] ?? `/plugins/${pluginPackages[id]}/`}manifest.json`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('App package is unavailable.');
  const manifest: PluginManifest = await response.json();
  if (!manifest || manifest.schemaVersion !== 1 || manifest.hostApiVersion !== 1 || manifest.id !== id || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version) || !pluginAsset.test(manifest.entry) || !manifest.entry.endsWith('.js') || (manifest.styles !== undefined && (!pluginAsset.test(manifest.styles) || !manifest.styles.endsWith('.css')))) throw new Error('This app package is incompatible with Lumo.');
  return manifest;
}
