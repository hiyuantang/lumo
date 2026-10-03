// SPDX-License-Identifier: AGPL-3.0-only
import { piSettingsSaved } from './pi-settings-notifications';
import { useEffect, useState } from 'react';
import type { PiImageSettings as Settings } from '@lumo/sdk/api/pi';
import { getDataSource } from '@lumo/sdk/api/source';
import { PiSettingToggle } from './PiSettingToggle';

export function PiImageSettings({ onBusy, onNotify, disabled, revision }: { onBusy: (busy: boolean) => void; onNotify: (message: string) => void; disabled: boolean; revision: number }) {
  const source = getDataSource();
  const [snapshot, setSnapshot] = useState<Settings | null>(null);
  const [pending, setPending] = useState<Settings['mode'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const changed = (event: Event) => setSnapshot((event as CustomEvent<Settings>).detail);
    window.addEventListener('lumo-pi-image-settings-saved', changed);
    return () => window.removeEventListener('lumo-pi-image-settings-saved', changed);
  }, []);
  useEffect(() => { onBusy(pending !== null); return () => onBusy(false); }, [pending, onBusy]);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    void source.piImageSettings().then((value) => { if (alive) setSnapshot(value); }).catch((err) => { if (alive) { setSnapshot(null); setError(err instanceof Error ? err.message : 'Could not load image settings.'); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [source, revision]);
  async function save(enabled: boolean) {
    if (!snapshot || pending || disabled) return;
    const mode = enabled ? 'quality90' : 'original';
    setPending(mode); setError('');
    try { const saved = await source.piSaveImageSettings({ mode, revision: snapshot.revision }); setSnapshot(saved); window.dispatchEvent(new CustomEvent('lumo-pi-image-settings-saved', { detail: saved })); onNotify(piSettingsSaved()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save image settings.'); }
    finally { setPending(null); }
  }
  const mode = pending ?? snapshot?.mode ?? 'original';
  return <div data-testid="pi-image-settings">
    <PiSettingToggle label="Image compression" description={mode === 'quality90' ? 'Quality 90' : 'Original'} checked={mode === 'quality90'} disabled={disabled || loading || pending !== null || !snapshot} onChange={(enabled) => { void save(enabled); }} testId="pi-image-quality"/>
    {error && <p className="pi-settings-error" role="alert">{error}</p>}
    {(loading || pending) && <p role="status">{loading ? 'Loading…' : 'Saving…'}</p>}
  </div>;
}
