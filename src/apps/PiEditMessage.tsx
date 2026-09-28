// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { getDataSource } from '../api/source';
import type { PiForkMessage } from '../api/pi';
import { Select } from '../shell/Select';
import { AppConfirmation } from './ServerAppUI';

export function PiEditMessage({ connection, onCancel, onResend }: { connection: string; onCancel: () => void; onResend: (entryId: string, text: string) => Promise<void> }) {
  const [messages, setMessages] = useState<PiForkMessage[]>([]);
  const [entryId, setEntryId] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    void getDataSource().piCommand(connection, { type: 'get_fork_messages' }).then((reply) => {
      if (disposed) return;
      if (!reply.success) throw new Error(reply.error || 'Could not load earlier messages.');
      const items = (reply.data as unknown as { messages?: PiForkMessage[] })?.messages ?? [];
      setMessages(items); setEntryId(items.at(-1)?.entryId ?? ''); setText(items.at(-1)?.text ?? '');
    }).catch((err) => { if (!disposed) setError(err instanceof Error ? err.message : 'Could not load earlier messages.'); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [connection]);
  async function resend() {
    setSending(true); setError('');
    try { await onResend(entryId, text.trim()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not resend this message.'); }
    finally { setSending(false); }
  }
  return <AppConfirmation title="Edit & resend" confirm="Resend" busy={sending} confirmDisabled={loading || !entryId || !text.trim()} onCancel={onCancel} onConfirm={() => void resend()}>
    <div className="pi-edit-message">
      <p>Continue in a new chat. Your original chat stays saved.</p>
      {loading ? <p role="status">Loading messages…</p> : messages.length > 0 ? <>
        <Select aria-label="Earlier message" value={entryId} disabled={sending} options={messages.map((item, index) => ({ value: item.entryId, label: `${index + 1}. ${item.text.replace(/\s+/g, ' ').slice(0, 90)}` }))} onChange={(id) => { setEntryId(id); setText(messages.find((item) => item.entryId === id)?.text ?? ''); }}/>
        <textarea className="input" aria-label="Edited message" value={text} onChange={(event) => setText(event.target.value)} disabled={sending} rows={6}/>
      </> : !error && <p>No earlier messages to edit.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </AppConfirmation>;
}
