// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import type { PiArchivedSession } from '@lumo/sdk/api/pi';
import { getDataSource } from '@lumo/sdk/api/source';
import { IconRefresh, IconTrash } from '@lumo/sdk/shell/icons';
import { AppConfirmation } from '@lumo/sdk/apps/ServerAppUI';

export function PiArchivedChats({ disabled, onRestore, onBusy, revision }: { revision: number; disabled: boolean; onRestore: (project: string, session: string) => Promise<void>; onBusy: (busy: boolean) => void }) {
  const source = getDataSource();
  const [items, setItems] = useState<PiArchivedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [pending, setPending] = useState<PiArchivedSession[] | null>(null);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    void source.piArchivedSessions().then((value) => { if (!disposed) setItems(value); }).catch((err) => { if (!disposed) setError(err instanceof Error ? err.message : 'Could not load archived chats.'); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [source, epoch, revision]);
  async function restore(item: PiArchivedSession) {
    if (busy || disabled) return;
    setBusy(true); setError('');
    try { await onRestore(item.project, item.id); setItems((list) => list.filter((entry) => entry !== item)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not restore this chat.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!pending || busy) return;
    setBusy(true); setError('');
    try {
      for (const item of pending) {
        await source.piDeleteSession(item.project, item.id);
        setItems((list) => list.filter((entry) => entry !== item));
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete all selected chats. Remaining chats are still archived.'); }
    finally { setBusy(false); setPending(null); setEpoch((value) => value + 1); }
  }
  return <div className="pi-settings-scroll pi-archived" data-testid="pi-archived">
    <section>
      <div className="pi-archived-heading"><div><h2>Archived chats</h2><p>Archived conversations are kept here until you restore or delete them.</p></div><button className="btn btn-icon" aria-label="Refresh archived chats" title="Refresh archived chats" disabled={loading || busy} onClick={() => { setError(''); setEpoch((value) => value + 1); }}><IconRefresh size={16}/></button><button className="btn" disabled={loading || busy || !items.length} onClick={() => setPending([...items])}>Delete all</button></div>
      {error && <p className="pi-settings-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading archived chats…</p> : items.length === 0 ? <p className="pi-archive-empty">No archived chats.</p> : <ul className="pi-archive-list">{items.map((item) => <li key={`${item.project}/${item.id}`}><div className="pi-archive-description"><strong>{item.name}</strong><small title={item.project}>{item.project}</small></div><button className="btn" disabled={busy || disabled} onClick={() => void restore(item)}>Restore</button><button className="btn btn-icon" disabled={busy} aria-label={`Delete ${item.name}`} title="Delete permanently" onClick={() => setPending([item])}><IconTrash size={16}/></button></li>)}</ul>}
    </section>
    {pending && <AppConfirmation title={pending.length === 1 ? 'Delete archived conversation?' : 'Delete all archived chats?'} confirm={pending.length === 1 ? 'Delete permanently' : `Delete ${pending.length} chats`} busy={busy} onCancel={() => setPending(null)} onConfirm={() => void remove()}><p>{pending.length === 1 ? `Delete “${pending[0].name}” permanently?` : `Delete ${pending.length} archived conversations permanently?`}</p></AppConfirmation>}
  </div>;
}
