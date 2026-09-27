// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import { Skills } from './Skills';
import { Trash } from './Trash';
import { OpenCode } from './OpenCode';
import { Preview } from './Preview';
import { Files } from './Files';
import { Monitor } from './Monitor';
import type { AppId } from './registry';
import { Settings } from './Settings';
import { Terminal } from './Terminal';
import { Containers } from './Containers';
import { Websites } from './Websites';
import { AppLibrary } from './AppLibrary';

export const APP_COMPONENTS: Record<AppId, ComponentType> = {
  skills: Skills,
  trash: Trash,
  preview: Preview,
  opencode: OpenCode,
  library: AppLibrary,
  containers: Containers,
  websites: Websites,
  home: Monitor,
  files: Files,
  terminal: Terminal,
  settings: Settings,
};
