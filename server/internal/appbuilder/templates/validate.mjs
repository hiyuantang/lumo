// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.env.LUMO_EXECUTABLE || 'lumod', ['native-app', 'validate'], { input: JSON.stringify({ project: fileURLToPath(new URL('.', import.meta.url)) }), encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exitCode = result.status ?? 1;
