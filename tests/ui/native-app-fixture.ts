// SPDX-License-Identifier: AGPL-3.0-only
import { readFile, readdir } from 'node:fs/promises';
import type { Route } from '../offline';

export async function nativeAppRoute(route: Route): Promise<boolean> {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === '/api/v1/notifications') { await route.fulfill({ json: { ok: true, data: [] } }); return true; }
  if (pathname === '/api/v1/app-plugins') {
    const names = await readdir('public/plugins');
    const apps = await Promise.all(names.map(async (name) => {
      const manifest = JSON.parse(await readFile(`public/plugins/${name}/manifest.json`, 'utf8'));
      delete manifest.background;
      const current = { digest: manifest.entry.slice(0, 64), manifest };
      return { name, installed: true, current, releases: [current], history: [], revision: '' };
    }));
    await route.fulfill({ json: { ok: true, data: apps } });
    return true;
  }
  const asset = pathname.match(/^\/api\/v1\/app-plugins\/assets\/([a-z][a-z0-9-]*)\/(manifest\.json|[a-f0-9]{64}\.(js|css))$/);
  if (!asset) return false;
  const body = await readFile(`public/plugins/${asset[1]}/${asset[2]}`);
  await route.fulfill({ body, contentType: asset[2].endsWith('.json') ? 'application/json' : asset[2].endsWith('.js') ? 'application/javascript' : 'text/css' });
  return true;
}
