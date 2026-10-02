// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType, SVGProps } from 'react';
import { IconCalendar, IconBranch, IconSkills, IconTrash, IconCode, IconEye, IconBoxes, IconFolder, IconGear, IconGlobe, IconGrid, IconMonitor, IconTerminal } from '../shell/icons';

export type AppId = 'calendar' | 'git' | 'skills' | 'trash' | 'pi' | 'preview' | 'home' | 'files' | 'terminal' | 'settings' | 'containers' | 'websites' | 'library';
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

export const APPS: Record<AppId, AppMeta> = {
  calendar: { id: 'calendar', title: 'Calendar', icon: IconCalendar, defaultSize: { w: 1100, h: 720 }, minSize: { w: 390, h: 380 } },
  git: { id: 'git', requiredPackage: 'git', title: 'Git', icon: IconBranch, defaultSize: { w: 1060, h: 680 }, minSize: { w: 390, h: 400 } },
  skills: { id: 'skills', title: 'Skills', icon: IconSkills, defaultSize: { w: 960, h: 650 }, minSize: { w: 390, h: 380 } },
  trash: { id: 'trash', title: 'Trash', icon: IconTrash, defaultSize: { w: 860, h: 590 }, minSize: { w: 390, h: 320 } },
  pi: { id: 'pi', requiredPackage: 'pi', title: 'Pi', icon: IconCode, defaultSize: { w: 980, h: 680 }, minSize: { w: 460, h: 360 } },
  preview: { id: 'preview', title: 'Preview', icon: IconEye, defaultSize: { w: 840, h: 620 }, minSize: { w: 380, h: 300 } },
  library: { id: 'library', title: 'App Library', icon: IconGrid, defaultSize: { w: 900, h: 630 }, minSize: { w: 390, h: 380 } },
  containers: { id: 'containers', requiredPackage: 'docker', title: 'Docker', icon: IconBoxes, defaultSize: { w: 920, h: 610 }, minSize: { w: 390, h: 380 } },
  websites: { id: 'websites', requiredPackage: 'nginx', title: 'Nginx', icon: IconGlobe, defaultSize: { w: 960, h: 650 }, minSize: { w: 390, h: 380 } },
  home: {
    id: 'home',
    title: 'Monitor',
    icon: IconMonitor,
    defaultSize: { w: 980, h: 640 },
    minSize: { w: 420, h: 380 },
  },
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
};

export const CORE_APP_COUNT = APP_ORDER.filter((id) => !APPS[id].requiredPackage).length;
