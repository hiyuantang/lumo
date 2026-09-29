// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { getDataSource } from '../api/source';
import type { PiInstruction, PiInstructionKind } from '../api/pi';
import { IconRefresh } from '../shell/icons';

export function PiInstructionEditor({ kind, onDirty, onBusy }: { kind: PiInstructionKind; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void }) {
  const source = getDataSource();
  const title = kind === 'instructions' ? 'Agent instructions' : 'Additional system instructions';
  const [snapshot, setSnapshot] = useState<PiInstruction | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const dirty = snapshot !== null && content !== snapshot.content;
  useEffect(() => { onDirty(dirty || saving); return () => onDirty(false); }, [dirty, saving, onDirty]);
  useEffect(() => { onBusy(saving); return () => onBusy(false); }, [saving, onBusy]);
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
  return <section className="pi-settings-instructions" aria-label={title}>
    <div className="pi-instruction-heading"><h2>{title}</h2><div>
      <button className="btn btn-icon" title={`Reload ${title.toLowerCase()}`} aria-label={kind === 'instructions' ? 'Reload instructions' : 'Reload additional system instructions'} disabled={dirty || saving || loading} onClick={() => setEpoch((value) => value + 1)}><IconRefresh size={16}/></button>
      {dirty && <button className="btn" disabled={saving} onClick={() => { setContent(snapshot?.content ?? ''); setError(''); }}>Cancel</button>}
      <button className="btn btn-primary" disabled={!dirty || saving || loading} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
    </div></div>
    <p>{kind === 'instructions' ? 'Coding preferences and conventions shared across your projects.' : 'Extra guidance appended to Pi’s system prompt.'} Changes apply when you reopen a chat.</p>
    {snapshot && <p className="pi-settings-path mono" title={snapshot.path}>{snapshot.path}</p>}
    {loading ? <p role="status">Loading instructions…</p> : snapshot && <textarea className="input mono pi-instruction-editor" aria-label={title} data-testid={kind === 'instructions' ? 'pi-instructions' : 'pi-append-instructions'} value={content} disabled={saving} onChange={(event) => { setContent(event.target.value); setSaved(false); }} placeholder={kind === 'instructions' ? 'Your coding preferences, conventions, and guidance…' : 'Extra instructions added to Pi’s system prompt…'} spellCheck={false}/>}
    {error && <p className="pi-settings-error" role="alert">{error}</p>}
    <span className="pi-instruction-status" role="status">{saved ? 'Saved' : dirty ? 'Unsaved changes' : ''}</span>
  </section>;
}
