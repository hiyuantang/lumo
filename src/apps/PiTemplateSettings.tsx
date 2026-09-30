// SPDX-License-Identifier: AGPL-3.0-only
import { piSettingsSaved } from './pi-settings-notifications';
import { useEffect, useState } from 'react';
import type { PiTemplate } from '../api/pi';
import { getDataSource } from '../api/source';
import { templateCatalog, templateContent, templateParts } from './piTemplates';
import { IconRefresh } from '../shell/icons';

export function PiTemplateSettings({ onDirty, onBusy, onSaved, onNotify }: { onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onSaved: () => void; onNotify: (message: string) => void }) {
  const source = getDataSource();
  const [items, setItems] = useState<PiTemplate[]>([]);
  const [selected, setSelected] = useState<PiTemplate | null>(null);
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const content = templateContent(selected?.content ?? '', description, body);
  const dirty = Boolean(selected && (name !== selected.name || body !== templateParts(selected.content).body || description !== templateParts(selected.content).description));
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  async function load() { setBusy(true); setError(''); try { setItems(templateCatalog(await source.piTemplates())); } catch (err) { setError(err instanceof Error ? err.message : 'Could not load templates.'); } finally { setBusy(false); } }
  useEffect(() => { void load(); }, []);
  function edit(item: PiTemplate) { const parts = templateParts(item.content); setSelected(item); setName(item.name); setDescription(parts.description); setBody(parts.body); setError(''); }
  async function save(remove = false) {
    if (!selected || busy) return; setBusy(true); setError('');
    try { await source.piSaveTemplate({ name, content, revision: selected.revision }, remove); setItems(templateCatalog(await source.piTemplates())); setSelected(null); onSaved(); onNotify(remove ? name === 'init' ? 'Template reset' : 'Template moved to Trash' : piSettingsSaved()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save this template.'); }
    finally { setBusy(false); }
  }
  return <div className="pi-settings-scroll pi-template-settings">
    <div className="pi-instruction-heading"><h2>Prompt templates</h2><div><button className="btn btn-icon" aria-label="Refresh templates" disabled={dirty || busy} onClick={() => void load()}><IconRefresh size={16}/></button><button className="btn" disabled={dirty || busy} onClick={() => edit({ name: '', content: '', path: '', revision: '' })}>New template</button></div></div>
    <p>Reusable prompts available through /name. Selecting one puts editable text into the composer. Changes apply immediately.</p>
    {selected ? <section className="pi-template-editor">
      <input className="input" aria-label="Template name" placeholder="Template name, e.g. review" value={name} disabled={busy || Boolean(selected.name)} maxLength={64} onChange={(event) => setName(event.target.value)}/>
      <input className="input" aria-label="Template description" placeholder="Short description" value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)}/>
      <textarea className="input mono pi-instruction-editor" aria-label="Template prompt" value={body} disabled={busy} onChange={(event) => setBody(event.target.value)} spellCheck={false}/>
      <p>Use $ARGUMENTS for all supplied text, $1 for the first argument, or {'${1:-default}'} for a default.</p>
      <div className="pi-template-actions">{selected.path && <button className="btn" disabled={busy} onClick={() => void save(true)}>{name === 'init' ? 'Reset to default' : 'Move to Trash'}</button>}<button className="btn" disabled={busy} onClick={() => setSelected(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || !name.trim() || !body.trim() || (!dirty && Boolean(selected.path))} onClick={() => void save()}>Save</button></div>
    </section> : <div className="pi-template-list">{items.map((item) => <section key={item.name}><div><strong>/{item.name}</strong><p>{templateParts(item.content).description}</p></div><button className="btn" disabled={busy} onClick={() => edit(item)}>Edit</button></section>)}</div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
