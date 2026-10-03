// SPDX-License-Identifier: AGPL-3.0-only
import { piSettingsSaved } from './pi-settings-notifications';
import { useEffect, useState } from 'react';
import { getDataSource } from '../api/source';
import type { PiExtensionSettings } from '../api/lumo-use';
import { IconRefresh } from '../shell/icons';
import { PiImageSettings } from './PiImageSettings';
import { PiSettingToggle } from './PiSettingToggle';

export function PiExtensions({ onBusy, onNotify, onSaved, applying, running }: { onBusy: (busy: boolean) => void; onNotify: (message: string) => void; onSaved: (settings: PiExtensionSettings) => void; applying: boolean; running: boolean }) {
  const source = getDataSource();
  const [snapshot, setSnapshot] = useState<PiExtensionSettings | null>(null);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState(''); const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const changed = (event: Event) => setSnapshot((event as CustomEvent<PiExtensionSettings>).detail);
    window.addEventListener('lumo-pi-extensions-saved', changed);
    return () => window.removeEventListener('lumo-pi-extensions-saved', changed);
  }, []);
  useEffect(() => { onBusy(saving || imageBusy); return () => onBusy(false); }, [saving, imageBusy, onBusy]);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    void source.piExtensions().then((value) => { if (alive) setSnapshot(value); }).catch((err) => { if (alive) { setSnapshot(null); setError(err instanceof Error ? err.message : 'Could not load extensions.'); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [source, epoch]);
  async function save(value: PiExtensionSettings) {
    if (!snapshot || saving || imageBusy || applying) return;
    setSaving(true); setError('');
    try { const saved = await source.piSaveExtensions(value); setSnapshot(saved); onSaved(saved); onNotify(piSettingsSaved(running)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save extensions.'); }
    finally { setSaving(false); }
  }
  return <div className="pi-settings-scroll pi-extensions" data-testid="pi-extension-settings"><section>
    <div className="pi-context-heading"><h2>Extensions</h2><button className="btn btn-icon" aria-label="Reload extensions" title="Reload extensions" disabled={loading || saving || imageBusy || applying} onClick={() => setEpoch((value) => value + 1)}><IconRefresh size={16}/></button></div>
    <div className="pi-extension-list">
    <div className="pi-extension-item"><PiSettingToggle label="Lumo Use" description="Let Pi observe and operate this desktop." checked={snapshot?.lumoUse ?? false} disabled={!snapshot || loading || saving || imageBusy || applying} onChange={(enabled) => { if (snapshot) void save({ ...snapshot, lumoUse: enabled }); }} testId="pi-lumo-use"/></div>
    <div className="pi-extension-item"><PiSettingToggle label="Lumo App Builder" description="Let Pi create, preview and install Lumo apps. Installed apps keep working when disabled." checked={snapshot?.appBuilder ?? true} disabled={!snapshot || loading || saving || imageBusy || applying} onChange={(enabled) => { if (snapshot) void save({ ...snapshot, appBuilder: enabled }); }} testId="pi-app-builder-enabled"/></div>
    <div className="pi-extension-item"><PiSettingToggle label="Questions" description="Let Pi ask you questions." checked={snapshot?.questions ?? true} disabled={!snapshot || loading || saving || imageBusy || applying} onChange={(enabled) => { if (snapshot) void save({ ...snapshot, questions: enabled }); }} testId="pi-questions-enabled"/></div>
    <div className="pi-extension-item"><PiSettingToggle label="Calendar & Reminders" description="Let Pi manage events and Lumo reminders." checked={snapshot?.calendar ?? true} disabled={!snapshot || loading || saving || imageBusy || applying} onChange={(enabled) => { if (snapshot) void save({ ...snapshot, calendar: enabled }); }} testId="pi-calendar-enabled"/></div>
    <div className="pi-extension-item"><PiImageSettings onBusy={setImageBusy} onNotify={onNotify} disabled={saving || applying} revision={epoch}/></div>
    {snapshot?.extensions?.map((extension) => <div className="pi-extension-item" key={extension.id}><PiSettingToggle label={extension.name} checked={extension.enabled} disabled={loading || saving || imageBusy || applying} onChange={(enabled) => { void save({ ...snapshot, extensions: snapshot.extensions?.map((item) => item.id === extension.id ? { ...item, enabled } : item) }); }} testId={`pi-extension-${extension.id}`}/></div>)}
    </div>
    {(loading || saving || applying) && <p role="status">{loading ? 'Loading…' : saving ? 'Saving…' : 'Applying…'}</p>}
    {error && <p className="pi-settings-error" role="alert">{error}</p>}
  </section></div>;
}
