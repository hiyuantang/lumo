// SPDX-License-Identifier: AGPL-3.0-only
package desktopapps

const ReactTSX = `// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Field, Panel, Status } from '@lumo/ui';
function App() {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [revision, setRevision] = useState('');
  const [status, setStatus] = useState('Loading');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    lumo.call('app.storage.get').then((data) => {
      if (!active) return;
      if (data.value !== null && (typeof data.value !== 'object' || Array.isArray(data.value) || !('text' in data.value) || typeof data.value.text !== 'string')) throw new Error('Saved data has an unsupported format. It has been preserved.');
      const next = data.value === null ? '' : (data.value as { text: string }).text;
      setText(next); setSaved(next); setRevision(data.revision); setStatus('Saved'); setLoaded(true); lumo.ready();
    }).catch((error) => { if (active) setStatus(error.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  async function save() {
    setBusy(true); setStatus('Saving');
    try {
      const result = await lumo.call('app.storage.set', { revision, value: { text } });
      setRevision(result.revision); setSaved(text); lumo.setDirty(false); setStatus('Saved');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Save failed. Your edits are still here.'); }
    finally { setBusy(false); }
  }
  return <><h1>TITLE</h1><Panel title="Saved message"><Field label="Message" value={text} maxLength={12000} disabled={busy || !loaded} onChange={(event) => { setText(event.target.value); lumo.setDirty(event.target.value !== saved); setStatus(event.target.value === saved ? 'Saved' : 'Unsaved changes'); }}/><Button disabled={busy || !loaded || text === saved} onClick={save}>Save</Button><Status>{status}</Status></Panel></>;
}
createRoot(document.getElementById('app')!).render(<App/>);
`
const ReactTypes = `
declare namespace JSX { interface IntrinsicElements { [element: string]: any } }
declare module 'react' {
  export function useState<T>(initial: T): [T, (value: T | ((previous: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void;
}
declare module 'react-dom/client' { export function createRoot(element: Element): { render(value: any): void }; }
declare module '@lumo/ui' {
  export function Button(props: { children?: any; disabled?: boolean; onClick?: () => void; [key: string]: any }): any;
  export function Field(props: { label: string; value?: string; onChange?: (event: { target: { value: string } }) => void; [key: string]: any }): any;
  export function Panel(props: { title: string; children?: any }): any;
  export function Status(props: { children?: any }): any;
}
`
