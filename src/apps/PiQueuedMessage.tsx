// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { DropdownMenu } from '../shell/DropdownMenu';
import { IconMore, IconSend } from '../shell/icons';
import { attachmentPrompt, splitAttachmentPrompt } from './piAttachments';
import { AttachmentCards } from './PiAttachmentCards';

export interface QueuedMessage { id: string; text: string; type: 'steer' | 'follow_up' }
export function PiQueuedMessage({ item, disabled, onChange }: { item: QueuedMessage; disabled: boolean; onChange: (item: QueuedMessage, action: 'edit' | 'delete' | 'send', text?: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const parts = splitAttachmentPrompt(item.text);
  const [text, setText] = useState(parts.text);
  return <div className="pi-queued-card" data-testid="pi-queued-message">
    <div className="pi-queued-content">
      <AttachmentCards paths={parts.paths} references={parts.references} order={parts.order}/>
      {editing ? <><textarea className="input" aria-label="Edit queued message" autoFocus value={text} onChange={(event) => setText(event.target.value)} rows={2}/><div className="pi-queued-edit-actions"><button className="btn btn-ghost" disabled={disabled} onClick={() => setEditing(false)}>Cancel</button><button className="btn" disabled={disabled || (!text.trim() && !parts.paths.length && !parts.references.length)} onClick={() => void onChange(item, 'edit', attachmentPrompt(text, parts.paths, parts.references, parts.order)).then((ok) => { if (ok) setEditing(false); })}>Save</button></div></> : <p>{parts.text || 'Attached context'}</p>}
    </div>
    <div className="pi-queued-actions"><button className="btn btn-icon" type="button" aria-label="Send now" title="Send now" disabled={disabled || editing || item.type === 'steer'} onClick={() => void onChange(item, 'send')}><IconSend size={16}/></button><DropdownMenu label="Queued message options" ariaLabel="Queued message options" testId={`pi-queued-menu-${item.id}`} icon={<IconMore size={16}/>} className="btn-icon" disabled={disabled || editing} items={[{ label: 'Edit', run: () => { setText(parts.text); setEditing(true); } }, { label: 'Delete', danger: true, run: () => { void onChange(item, 'delete'); } }]}/></div>
  </div>;
}
