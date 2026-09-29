// SPDX-License-Identifier: AGPL-3.0-only
import type { DragEvent } from 'react';
import type { PiSession } from '../api/pi';
import { setDragPreview } from '../shell/dragPreview';

const mime = 'application/x-lumo-pi-conversation';
let dragged: { token: string; project: string; session: string; name: string } | null = null;
export function conversationDrag(project: string, session: PiSession) {
  return {
    draggable: true,
    onDragStart(event: DragEvent<HTMLElement>) {
      dragged = { token: crypto.randomUUID(), project, session: session.id, name: session.name };
      event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData(mime, dragged.token);
      setDragPreview(event, session.name, 'conversation');
    },
    onDragEnd() { dragged = null; },
  };
}
export function isConversationDrag(event: DragEvent<HTMLElement>) { return event.dataTransfer.types.includes(mime); }
export function takeConversationDrag(event: DragEvent<HTMLElement>) {
  const reference = dragged;
  dragged = null;
  return reference && event.dataTransfer.getData(mime) === reference.token ? reference : null;
}
