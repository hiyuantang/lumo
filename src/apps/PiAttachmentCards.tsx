// SPDX-License-Identifier: AGPL-3.0-only
import { PiImage } from './PiImages';
import { imageType } from './ImagePreview';
import type { ReactNode } from 'react';
import { attachmentKeys, conversationAttachmentKey, fileAttachmentKey } from './piAttachments';
import type { PiConversationReference } from '../api/pi';
import { IconChatBubble, IconFile, IconFolder, IconX } from '../shell/icons';

function attachmentName(name: string) {
  const characters = Array.from(name);
  return characters.length > 24 ? characters.slice(0, 23).join('') + '…' : name;
}

export function AttachmentCards({ paths, references = [], order, disabled, onRemove, onRemoveReference }: { paths: string[]; references?: PiConversationReference[]; order?: string[]; disabled?: boolean; onRemove?: (path: string) => void; onRemoveReference?: (path: string) => void }) {
  if (!paths.length && !references.length) return null;
  const cards = new Map<string, ReactNode>();
  references.forEach((item) => cards.set(conversationAttachmentKey(item), <div className="pi-attachment pi-attachment-conversation" key={conversationAttachmentKey(item)} title={`${item.name}\n${item.project}`} data-testid="pi-conversation-reference">
      <IconChatBubble size={44}/><span>{attachmentName(item.name)}</span>
      {onRemoveReference && <button type="button" disabled={disabled} aria-label={`Remove conversation ${item.name}`} title="Remove conversation reference" onClick={() => onRemoveReference(item.path)}><IconX size={12}/></button>}
    </div>));
  paths.forEach((path) => {
    const name = path.split('/').filter(Boolean).at(-1) || path;
    const folder = path.endsWith('/');
    const Icon = folder ? IconFolder : IconFile;
    cards.set(fileAttachmentKey(path), <div className={`pi-attachment pi-attachment-${folder ? 'folder' : 'file'}`} key={fileAttachmentKey(path)} title={path} data-testid="pi-attachment" data-kind={folder ? 'folder' : 'file'}>
      <>{!folder && imageType(name) ? <PiImage path={path} alt={name} thumbnail/> : <Icon size={44}/>}</><span>{attachmentName(name)}</span>
      {onRemove && <button type="button" aria-label={`Remove ${name}`} title="Remove attachment" disabled={disabled} onClick={() => onRemove(path)}><IconX size={12}/></button>}
    </div>);
  });
  return <div className="pi-attachments" aria-label="Attached context">{attachmentKeys(paths, references, order).map((key) => cards.get(key))}</div>;
}
