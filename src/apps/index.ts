// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import type { ShippedAppId } from './registry';
import { pluginManifests } from '../platform/plugins';
import { PluginApp } from '../platform/PluginApp';
export const APP_COMPONENTS = Object.fromEntries(pluginManifests.map(app => [app.id, PluginApp])) as unknown as Record<ShippedAppId, ComponentType>;
