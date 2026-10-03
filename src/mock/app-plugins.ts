// SPDX-License-Identifier: AGPL-3.0-only
import type { NativeApp, NativeBundle, NativeChange } from '../api/app-plugins';
import { pluginManifests, pluginPackages } from '../platform/plugins';

let apps: NativeApp[] | undefined;
export async function nativeApps() {
  if (!apps) apps = pluginManifests.map((definition) => {
    const name = pluginPackages[definition.id];
    const manifest = { ...definition, entry: '0'.repeat(64) + '.js' };
    const release = { digest: manifest.entry.slice(0,64), manifest };
    return { name, installed: true, current: release, releases: [release], revision: '', history: [] };
  });
  return structuredClone(apps);
}
export async function importNativeApp(bundle: NativeBundle) {
  await nativeApps();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(bundle.manifest))))).map((n) => n.toString(16).padStart(2,'0')).join('');
  const release = { digest, manifest: bundle.manifest };
  const app = apps!.find((app) => app.name === bundle.name);
  if (app) app.releases.unshift(release); else apps!.push({ name: bundle.name, installed: false, releases: [release], revision: '', history: [] });
  return structuredClone(apps!);
}
export async function changeNativeApp(change: NativeChange) {
  await nativeApps();
  const app = apps!.find((app) => app.name === change.name);
  if (!app || app.revision !== change.revision) throw new Error('App selection changed; refresh and try again.');
  if (change.action === 'uninstall') { app.installed = false; app.previous = app.current?.digest; app.current = undefined; }
  else {
    if (!change.trust) throw new Error('Trust this app before installing.');
    const release = app.releases.find((release) => release.digest === (change.action === 'rollback' ? app.previous : change.digest));
    if (!release) throw new Error('App release unavailable.');
    app.previous = app.current?.digest;
    app.history.push({ from: app.current?.manifest.version ?? '', to: release.manifest.version, at: new Date().toISOString() });
    app.current = release; app.installed = true;
  }
  app.revision = crypto.randomUUID();
  return structuredClone(apps!);
}
