// SPDX-License-Identifier: AGPL-3.0-only
import { pluginManifests } from '../platform/plugins';
import * as Icons from '../shell/icons';
import type { ComponentType, SVGProps } from 'react';
import { IconGrid } from '../shell/icons';

export type ShippedAppId = 'calendar' | 'git' | 'skills' | 'trash' | 'pi' | 'preview' | 'home' | 'files' | 'terminal' | 'settings' | 'containers' | 'websites' | 'library';
export type AppId = ShippedAppId | `app:${string}` | `plugin:${string}`;
export type SettingsSection = 'system' | 'folders' | 'time' | 'network' | 'appearance' | 'updates' | 'about';

export interface AppMeta {
  id: AppId;
  requiredPackage?: 'git' | 'docker' | 'nginx' | 'pi';
  iconImage?: string;
  multipleWindows?: boolean;
  title: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
}

export const APP_ORDER: AppId[] = ['home', 'files', 'preview', 'terminal', 'git', 'pi', 'calendar', 'containers', 'websites', 'library', 'skills', 'settings', 'trash'];

const builtinApps = {
  ...Object.fromEntries(pluginManifests.map((manifest) => [manifest.id, {
    multipleWindows: manifest.window.multiple ?? false, id: manifest.id, title: manifest.name, icon: Icons[manifest.icon as keyof typeof Icons],
    defaultSize: { w: manifest.window.width, h: manifest.window.height },
    minSize: { w: manifest.window.minWidth, h: manifest.window.minHeight },
    requiredPackage: 'requiredPackage' in manifest ? manifest.requiredPackage : undefined,
  }])),
} as Record<ShippedAppId, AppMeta>;

export const APPS = new Proxy(builtinApps as Record<AppId, AppMeta>, {
  get(target, key) {
    if (typeof key === 'string' && (key.startsWith('app:') || key.startsWith('plugin:')) && !target[key as AppId]) return { id: key, title: 'Desktop app', icon: IconGrid, defaultSize: { w: 720, h: 480 }, minSize: { w: 390, h: 320 } };
    return Reflect.get(target, key);
  },
});

export const CORE_APP_COUNT = APP_ORDER.filter((id) => !APPS[id].requiredPackage).length;
