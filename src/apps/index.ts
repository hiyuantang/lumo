// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import { Git } from './Git';
import { Skills } from './Skills';
import { Trash } from './Trash';
import { Pi } from './Pi';
import { Preview } from './Preview';
import { Files } from './Files';
import { Monitor } from './Monitor';
import type { AppId } from './registry';
import { Settings } from './Settings';
import { Terminal } from './Terminal';
import { Docker as Containers } from './Docker';
import { Websites } from './Websites';
import { AppLibrary } from './AppLibrary';

export const APP_COMPONENTS: Record<AppId, ComponentType> = {
  git: Git,
  skills: Skills,
  trash: Trash,
  preview: Preview,
  pi: Pi,
  library: AppLibrary,
  containers: Containers,
  websites: Websites,
  home: Monitor,
  files: Files,
  terminal: Terminal,
  settings: Settings,
};
