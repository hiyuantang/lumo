// SPDX-License-Identifier: AGPL-3.0-only
import { DropdownMenu } from '@lumo/sdk/shell/DropdownMenu';
import { IconMore, IconSend } from '@lumo/sdk/shell/icons';
import { splitAttachmentPrompt } from './piAttachments';
import { AttachmentCards } from './PiAttachmentCards';

export interface QueuedMessage { id: string; text: string; type: 'steer' | 'follow_up' }
export function PiQueuedMessage({ item, disabled, onChange }: { item: QueuedMessage; disabled: boolean; onChange: (item: QueuedMessage, action: 'edit' | 'delete' | 'send') => Promise<boolean> }) {
  const parts = splitAttachmentPrompt(item.text);
  return <div className="pi-queued-card" data-testid="pi-queued-message">
    <div className="pi-queued-content">
      <AttachmentCards paths={parts.paths} references={parts.references} order={parts.order}/>
      <p>{parts.text || 'Attached context'}</p>
    </div>
    <div className="pi-queued-actions"><button className="btn btn-icon" type="button" aria-label="Send now" title="Send now" disabled={disabled || item.type === 'steer'} onClick={() => void onChange(item, 'send')}><IconSend size={16}/></button><DropdownMenu label="Queued message options" ariaLabel="Queued message options" testId={`pi-queued-menu-${item.id}`} icon={<IconMore size={16}/>} className="btn-icon" disabled={disabled} items={[{ label: 'Edit', run: () => { void onChange(item, 'edit'); } }, { label: 'Delete', danger: true, run: () => { void onChange(item, 'delete'); } }]}/></div>
  </div>;
}
