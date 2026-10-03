// SPDX-License-Identifier: AGPL-3.0-only
import { lazy, type ComponentType } from 'react';
import type { ShippedAppId } from './registry';
import { PluginApp } from '../platform/PluginApp';

export const APP_COMPONENTS: Record<ShippedAppId, ComponentType> = {
  calendar: PluginApp,
  git: PluginApp,
  skills: PluginApp,
  containers: PluginApp,
  websites: PluginApp,
  home: PluginApp,
  trash: lazy(() => import('./Trash').then((module) => ({ default: module.Trash }))),
  preview: lazy(() => import('./Preview').then((module) => ({ default: module.Preview }))),
  pi: lazy(() => import('./Pi').then((module) => ({ default: module.Pi }))),
  library: lazy(() => import('./AppLibrary').then((module) => ({ default: module.AppLibrary }))),
  files: lazy(() => import('./Files').then((module) => ({ default: module.Files }))),
  terminal: lazy(() => import('./Terminal').then((module) => ({ default: module.Terminal }))),
  settings: lazy(() => import('./Settings').then((module) => ({ default: module.Settings }))),
};
