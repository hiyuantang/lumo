// SPDX-License-Identifier: AGPL-3.0-only
import { getDataSource } from '../../../api/source';
export function requestPlugin(name: string, body?: Record<string, unknown>): Promise<unknown> { return getDataSource().pluginRequest(name, body); }
