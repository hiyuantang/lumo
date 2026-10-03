// SPDX-License-Identifier: AGPL-3.0-only
import { timezoneLabel } from '@lumo/sdk/utils/timezone';
import { Select } from '@lumo/sdk/shell/Select';
import { useId, useState } from 'react';
import { describeError, isReauthRequired, type SystemSettings, type SystemSettingsChange } from '@lumo/sdk/api/source';
import { ApiError } from '@lumo/sdk/api/transport';
import { useReauth } from '@lumo/sdk/shell/ReauthSheet';

interface Props {
  snapshot: SystemSettings;
  disabled: boolean;
  timezones?: string[];
  save: (change: SystemSettingsChange, revision: string) => Promise<void>;
  refresh: () => Promise<boolean>;
}

export function SettingsEditor({ snapshot, disabled, timezones, save, refresh }: Props) {
  const id = useId();
  const requireReauth = useReauth();
  const [draft, setDraft] = useState<{ value: string; revision: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const value = draft?.value ?? snapshot.timezone;
  const stale = conflict || (draft !== null && draft.revision !== snapshot.revision);
  const invalid = timezones && !timezones.includes(value)
    ? 'Choose an available time zone.'
    : null;

  function edit(next: string) {
    setDraft((current) => next === snapshot.timezone ? null : { value: next, revision: current?.revision ?? snapshot.revision });
    setError(null);
    setSaved(false);
    setConflict(false);
  }

  async function apply(pending: NonNullable<typeof draft>) {
    setBusy(true);
    setError(null);
    try {
      const change = { timezone: pending.value };
      await save(change, pending.revision);
      setDraft(null);
      setSaved(true);
      setConflict(false);
    } catch (err) {
      if (isReauthRequired(err)) {
        requireReauth(() => void apply(pending));
      } else if (err instanceof ApiError && (err.code === 'stale_revision' || err.code === 'conflict')) {
        setConflict(true);
        await refresh();
      } else {
        setError(describeError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-editor" data-testid="settings-editor-timezone" onSubmit={(event) => {
      event.preventDefault();
      if (draft && !invalid && !stale && !disabled && !busy) void apply(draft);
    }}>
      <label htmlFor={id}>Time zone</label>
      <Select id={id} aria-label="Time zone" data-testid="settings-timezone" value={value} onChange={edit} disabled={disabled || busy || !timezones?.length} aria-describedby={invalid && draft ? `${id}-invalid` : undefined} aria-invalid={Boolean(invalid && draft)}
        options={[...(!timezones?.includes(value) ? [value] : []), ...(timezones ?? [])].map((zone) => ({ value: zone, label: timezoneLabel(zone) }))} />
      {invalid && draft ? <p id={`${id}-invalid`} className="settings-field-error">{invalid}</p> : null}
      {stale ? <div className="settings-conflict" role="alert"><p>Settings changed on the server. Your draft is kept.</p><button type="button" className="btn" data-testid="settings-reload-timezone" disabled={disabled || busy} onClick={async () => {
        if (!await refresh()) return;
        setDraft(null);
        setConflict(false);
        setError(null);
      }}>Reload value</button></div> : null}
      {error ? <p className="settings-field-error" role="alert">{error}</p> : null}
      {draft ? <div className="settings-editor-actions"><span>Unsaved change</span><button type="button" className="btn" disabled={disabled || busy} onClick={() => { setDraft(null); setConflict(false); setError(null); }}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="settings-save-timezone" disabled={disabled || busy || Boolean(invalid) || stale}>{busy ? 'Saving…' : 'Save'}</button></div> : null}
      <span className="settings-saved" role="status">{saved && !draft ? 'Saved' : ''}</span>
    </form>
  );
}
