// SPDX-License-Identifier: AGPL-3.0-only
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import '../styles/apps.css';
import '../styles/server-apps.css';
import '../styles/preview.css';

const modules = import.meta.glob('./sdk/**/*.ts', { eager: true });
const host: Record<string, unknown> = { react: React, 'react/jsx-runtime': JSX, 'react-dom': ReactDOM };
for (const [path, module] of Object.entries(modules)) host['@lumo/sdk/' + path.slice(6, -3)] = module;
Object.defineProperty(globalThis, '__LUMO_HOST_V1__', { value: Object.freeze(host), configurable: true });
