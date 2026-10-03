// SPDX-License-Identifier: AGPL-3.0-only
import { pluginManifests } from '../platform/plugins';
import * as Icons from '../shell/icons';
import type { ComponentType, SVGProps } from 'react';
import { IconTrash, IconCode, IconEye, IconFolder, IconGear, IconGrid, IconTerminal } from '../shell/icons';

export type ShippedAppId = 'calendar' | 'git' | 'skills' | 'trash' | 'pi' | 'preview' | 'home' | 'files' | 'terminal' | 'settings' | 'containers' | 'websites' | 'library';
export type AppId = ShippedAppId | `app:${string}`;
export type SettingsSection = 'system' | 'folders' | 'time' | 'network' | 'appearance' | 'updates' | 'about';

export interface AppMeta {
  id: AppId;
  requiredPackage?: 'git' | 'docker' | 'nginx' | 'pi';
  title: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
}

export const APP_ORDER: AppId[] = ['home', 'files', 'preview', 'terminal', 'git', 'pi', 'calendar', 'containers', 'websites', 'library', 'skills', 'settings', 'trash'];

const builtinApps = {
  trash: { id: 'trash', title: 'Trash', icon: IconTrash, defaultSize: { w: 860, h: 590 }, minSize: { w: 390, h: 320 } },
  pi: { id: 'pi', requiredPackage: 'pi', title: 'Pi', icon: IconCode, defaultSize: { w: 980, h: 680 }, minSize: { w: 460, h: 360 } },
  preview: { id: 'preview', title: 'Preview', icon: IconEye, defaultSize: { w: 840, h: 620 }, minSize: { w: 380, h: 300 } },
  library: { id: 'library', title: 'App Library', icon: IconGrid, defaultSize: { w: 900, h: 630 }, minSize: { w: 390, h: 380 } },
  files: {
    id: 'files',
    title: 'Files',
    icon: IconFolder,
    defaultSize: { w: 1080, h: 630 },
    minSize: { w: 440, h: 340 },
  },
  terminal: {
    id: 'terminal',
    title: 'Terminal',
    icon: IconTerminal,
    defaultSize: { w: 640, h: 420 },
    minSize: { w: 380, h: 260 },
  },
  settings: {
    id: 'settings',
    title: 'Settings',
    icon: IconGear,
    defaultSize: { w: 840, h: 610 },
    minSize: { w: 440, h: 340 },
  },
  ...Object.fromEntries(pluginManifests.map((manifest) => [manifest.id, {
    id: manifest.id, title: manifest.name, icon: Icons[manifest.icon as keyof typeof Icons],
    defaultSize: { w: manifest.window.width, h: manifest.window.height },
    minSize: { w: manifest.window.minWidth, h: manifest.window.minHeight },
    requiredPackage: 'requiredPackage' in manifest ? manifest.requiredPackage : undefined,
  }])),
} as Record<ShippedAppId, AppMeta>;

export const APPS = new Proxy(builtinApps as Record<AppId, AppMeta>, {
  get(target, key) {
    if (typeof key === 'string' && key.startsWith('app:') && !target[key as AppId]) return { id: key, title: 'Desktop app', icon: IconGrid, defaultSize: { w: 720, h: 480 }, minSize: { w: 390, h: 320 } };
    return Reflect.get(target, key);
  },
});

export const CORE_APP_COUNT = APP_ORDER.filter((id) => !APPS[id].requiredPackage).length;
