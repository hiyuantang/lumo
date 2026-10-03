// SPDX-License-Identifier: AGPL-3.0-only
import type { NativeManifest } from '../api/app-plugins';

const definitions = import.meta.glob('../../apps/*/lumo.plugin.json', { eager: true, import: 'default' });
export const pluginManifests = Object.values(definitions) as NativeManifest[];
export const pluginPackages: Record<string, string> = Object.fromEntries(Object.entries(definitions).map(([path, value]) => [(value as NativeManifest).id, path.split('/')[3]]));
export type PluginId = string;
export const pluginBases: Record<string, string> = {};

export let pluginSession = crypto.randomUUID();
export function resetPluginSession() { pluginSession = crypto.randomUUID(); window.dispatchEvent(new Event('lumo:plugin-session')); }
