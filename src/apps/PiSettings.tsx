// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { getDataSource } from '../api/source';
import type { PiInstruction, PiInstructionKind } from '../api/pi';
import { IconArchive, IconFile, IconRefresh, IconUser } from '../shell/icons';
import { Select } from '../shell/Select';
import { PiProviders } from './PiProviders';
import { PiArchivedChats } from './PiArchivedChats';

interface Props {
  installed: boolean;
  provider?: string;
  setup: boolean;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  revision: number;
  onConnect: () => void;
  onDone: () => void;
  onDirty: (dirty: boolean) => void;
  onRestore: (project: string, session: string) => Promise<void>;
}
export function PiSettings({ installed, provider, setup, disabled, onBusy, revision, onConnect, onDone, onDirty, onRestore }: Props) {
  const source = getDataSource();
  const [tab, setTab] = useState<'providers' | 'instructions' | 'archived'>('providers');
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [kind, setKind] = useState<PiInstructionKind>('instructions');
  const [snapshot, setSnapshot] = useState<PiInstruction | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [providerDirty, setProviderDirty] = useState(false);
  useEffect(() => { onBusy(saving || archiveBusy); return () => onBusy(false); }, [saving, archiveBusy, onBusy]);
  const dirty = snapshot !== null && content !== snapshot.content;
  useEffect(() => { onDirty(dirty || saving || providerDirty || archiveBusy); return () => onDirty(false); }, [dirty, saving, providerDirty, archiveBusy, onDirty]);
  useEffect(() => {
    let disposed = false;
    setLoading(true); setSnapshot(null); setError(''); setSaved(false);
    void source.piSettings(kind).then((value) => { if (!disposed) { setSnapshot(value); setContent(value.content); } }).catch((err) => { if (!disposed) setError(err instanceof Error ? err.message : 'Could not load instructions.'); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [kind, epoch, source]);
  async function save() {
    if (!snapshot || saving) return;
    setSaving(true); setError(''); setSaved(false);
    try { const value = await source.piSaveSettings(kind, content, snapshot.revision); setSnapshot(value); setContent(value.content); setSaved(true); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save instructions.'); }
    finally { setSaving(false); }
  }
  const tabs = [{ id: 'providers' as const, label: 'Providers', icon: IconUser }, { id: 'instructions' as const, label: 'Instructions', icon: IconFile }, { id: 'archived' as const, label: 'Archived chats', icon: IconArchive }];
  return <main className="pi-main pi-settings" data-testid="pi-settings">
    <aside className="pi-settings-card">
      <h1>Settings</h1>
      <div className="pi-settings-nav" role="tablist" aria-label="Pi settings tabs" aria-orientation="vertical" onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (!buttons.length) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus(); buttons[next].click();
      }}>{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} role="tab" id={`pi-settings-tab-${id}`} aria-controls={`pi-settings-panel-${id}`} aria-label={label} title={label} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} disabled={archiveBusy || saving || setup} onClick={() => setTab(id)}><Icon size={18}/><span>{label}</span></button>)}</div>
    </aside>
    <div className="pi-settings-content">
      <div className="pi-settings-pane" id="pi-settings-panel-providers" role="tabpanel" aria-labelledby="pi-settings-tab-providers" hidden={tab !== 'providers'}>
        {setup ? <><div className="pi-provider-done"><button className="btn" onClick={onDone}>Done</button></div><PiProviders onDirty={setProviderDirty}/></> : <div className="pi-settings-scroll"><section className="pi-settings-provider">
          <div><h2>Providers</h2><p>{provider ? `Current provider: ${provider}` : 'Manage accounts and API keys.'}</p></div>
          <button className="btn" disabled={!installed || disabled || saving} onClick={onConnect}>Connect provider</button>
        </section></div>}
      </div>
      <div className="pi-settings-pane" id="pi-settings-panel-instructions" role="tabpanel" aria-labelledby="pi-settings-tab-instructions" hidden={tab !== 'instructions'}>
        <div className="pi-settings-scroll"><section className="pi-settings-instructions">
          <h2>Instructions</h2><p>Applies across your projects. Changes take effect when you reopen a project.</p>
          <div className="pi-settings-file">
            <Select aria-label="Instruction file" value={kind} disabled={dirty || saving || loading} onChange={(value) => setKind(value as PiInstructionKind)} options={[{ value: 'instructions', label: 'Agent instructions' }, { value: 'append', label: 'Additional system instructions' }]}/>
            <button className="btn btn-icon" aria-label="Reload instructions" disabled={dirty || saving || loading} onClick={() => setEpoch((value) => value + 1)}><IconRefresh size={16}/></button>
          </div>
          {snapshot && <p className="pi-settings-path mono" title={snapshot.path}>{snapshot.path}</p>}
          {loading ? <p role="status">Loading instructions…</p> : snapshot && <textarea className="input mono pi-instruction-editor" aria-label="User instructions" data-testid="pi-instructions" value={content} disabled={saving} onChange={(event) => { setContent(event.target.value); setSaved(false); }} placeholder={kind === 'instructions' ? 'Your coding preferences, conventions, and guidance…' : 'Extra instructions added to Pi’s system prompt…'} spellCheck={false}/>}
          {error && <p className="pi-settings-error" role="alert">{error}</p>}
          <div className="pi-settings-actions"><span role="status">{saved ? 'Saved' : dirty ? 'Unsaved changes' : ''}</span>{dirty && <button className="btn" disabled={saving} onClick={() => { setContent(snapshot?.content ?? ''); setError(''); }}>Cancel</button>}<button className="btn btn-primary" disabled={!dirty || saving || loading} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button></div>
        </section></div>
      </div>
      {tab === 'archived' && <div className="pi-settings-pane" id="pi-settings-panel-archived" role="tabpanel" aria-labelledby="pi-settings-tab-archived"><PiArchivedChats revision={revision} disabled={disabled} onRestore={onRestore} onBusy={setArchiveBusy}/></div>}
    </div>
  </main>;
}
