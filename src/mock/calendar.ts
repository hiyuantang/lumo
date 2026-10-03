// SPDX-License-Identifier: AGPL-3.0-only
import type { CalendarChange, CalendarCollection, CalendarGoogleAction, CalendarGoogleConfig, CalendarItem, CalendarSnapshot } from '../api/calendar';
import { dateKey, expandMock, localDate, repeatDate, zonedParts, zonedISO } from '../../apps/calendar/src/calendar-model';
const initialCollections: CalendarCollection[] = [{ id: 'personal', name: 'Personal', color: '#487ccc', kind: 'event', provider: 'local', readOnly: false }, { id: 'work', name: 'Work', color: '#b183c8', kind: 'event', provider: 'local', readOnly: false }, { id: 'reminders', name: 'Reminders', color: '#c28245', kind: 'reminder', provider: 'local', readOnly: false }];
export class MockCalendar {
  private collections = initialCollections;
  private items: CalendarItem[] = [];
  private successors: Record<string, string> = {};
  private status = { configured: false, connected: false, name: '', redirectUri: '' };
  private key = 'lumo.mock.calendar';
  constructor() {
    try { const saved = JSON.parse(localStorage.getItem(this.key) ?? 'null') as { collections: CalendarCollection[]; items: CalendarItem[]; successors?: Record<string, string> } | null; if (saved) { this.collections = saved.collections; this.items = saved.items; this.successors = saved.successors ?? {}; } } catch {}
  }
  private persist() { localStorage.setItem(this.key, JSON.stringify({ collections: this.collections, items: this.items, successors: this.successors })); }
  snapshot = async (from: string, to: string): Promise<CalendarSnapshot> => ({ collections: structuredClone(this.collections), items: structuredClone(this.items.filter((item) => !item.deleted)), occurrences: expandMock(this.items, new Date(from), new Date(to)), google: this.status });
  googleStatus = async () => this.status;
  google = async (_action: CalendarGoogleAction, _config?: CalendarGoogleConfig): Promise<never> => { throw new Error('Google connection requires a live Lumo server.'); };
  change = async (change: CalendarChange): Promise<CalendarItem> => {
    if (change.action === 'collection' && change.collection) { this.collections = [...this.collections, { ...change.collection, id: crypto.randomUUID(), provider: 'local', readOnly: false }]; this.persist(); return {} as CalendarItem; }
    if (change.item && change.action === 'save') {
      const item = structuredClone(change.item);
      if (!item.title.trim()) throw new Error('Enter a title.');
      if (item.kind === 'event' && localDate(item.end) <= localDate(item.start)) throw new Error('End must be after start.');
      if (item.kind === 'reminder' && item.repeat !== 'none' && !item.due) throw new Error('Repeating reminders need a due date.');
      const index = this.items.findIndex((old) => old.id === item.id);
      if (item.id && (index < 0 || this.items[index].revision !== item.revision)) throw new Error('This item changed. Reload before saving.');
      item.id ||= crypto.randomUUID(); item.revision = crypto.randomUUID(); item.deleted = false;
      if (index < 0) this.items.push(item); else this.items[index] = item;
      this.persist(); return structuredClone(item);
    }
    const item = this.items.find((item) => item.id === change.id);
    if (!item || item.revision !== change.revision) throw new Error('This item changed. Reload before saving.');
    if (change.action === 'complete' && item.kind === 'reminder') {
      item.completed = !item.completed;
      if (item.completed && item.repeat !== 'none' && !this.successors[item.id]) {
        const parts = zonedParts(item.due, item.timeZone), wall = new Date(`${parts.date}T${parts.time}`);
        let next = repeatDate(wall, item.repeat, 1);
        for (let n = 2; (item.repeat === 'monthly' || item.repeat === 'yearly') && next.getDate() !== wall.getDate() && n <= 12; n++) next = repeatDate(wall, item.repeat, n);
        const due = item.due.length === 10 ? dateKey(next) : zonedISO(dateKey(next), parts.time, item.timeZone);
        if (!item.repeatUntil || due.slice(0, 10) <= item.repeatUntil) {
          const clone = { ...item, id: crypto.randomUUID(), revision: crypto.randomUUID(), due, completed: false }; this.items.push(clone); this.successors[item.id] = clone.id;
        }
      }
    } else if (change.action === 'delete' || change.action === 'restore') item.deleted = change.action === 'delete';
    else throw new Error('Invalid calendar action.');
    item.revision = crypto.randomUUID(); this.persist(); return structuredClone(item);
  };
}
