// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { requestPlugin } from '@lumo/sdk/api/plugins';
import { useShell } from '@lumo/sdk/shell/ShellContext';
import { useCurrentWindow } from '@lumo/sdk/shell/WindowContext';
export default function App() {
  const { actions } = useShell();
  const win = useCurrentWindow();
  const [value, setValue] = useState({ revision: '', text: '' });
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Loading…');
  const [pending, setPending] = useState<null | (() => void)>(null);
  const dirty = ready && text !== value.text;
  useEffect(() => {
    let active = true;
    requestPlugin('__APP__').then(data => { if (active) { setValue(data); setText(data.text); setReady(true); setMessage(''); } }, error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, []);
  useLayoutEffect(() => actions.registerWindowGuard(win.id, proceed => {
    if (busy) return;
    if (dirty) setPending(() => proceed); else proceed();
  }), [actions, win.id, dirty, busy]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function save() {
    setBusy(true);
    try { const saved = await requestPlugin('__APP__', { text, revision: value.revision }); setValue(saved); setMessage('Saved'); }
    catch (error) { setMessage(error.message + ' Your draft is kept. Close and reopen after copying it to read the latest note.'); }
    finally { setBusy(false); }
  }
  return <section className="app plugin-__APP__">
    <header><h1>{__TITLE__}</h1><button className="btn" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></header>
    <label htmlFor={`note-${win.id}`}>Note</label>
    <textarea id={`note-${win.id}`} className="input" disabled={!ready || busy} value={text} onChange={event => setText(event.target.value)} />
    <p role="status">{message || (dirty ? 'Unsaved changes' : '')}</p>
    {pending && <div role="alertdialog" aria-label="Unsaved changes"><p>Discard this unsaved note?</p><div className="actions"><button className="btn" onClick={() => setPending(null)}>Keep editing</button><button className="btn" onClick={() => { const proceed = pending; setPending(null); proceed(); }}>Discard</button></div></div>}
  </section>;
}
