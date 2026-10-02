// SPDX-License-Identifier: AGPL-3.0-only
export type CalendarKind = 'event' | 'reminder';
export type CalendarRepeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export interface CalendarCollection { id: string; name: string; color: string; kind: CalendarKind; provider: 'local' | 'google'; readOnly: boolean }
export interface CalendarItem {
  id: string; collectionId: string; kind: CalendarKind; title: string; notes: string; location: string;
  start: string; end: string; due: string; allDay: boolean; timeZone: string; repeat: CalendarRepeat;
  repeatUntil: string; alertMinutes: number | null; flagged: boolean; priority: 'none' | 'low' | 'medium' | 'high';
  completed: boolean; revision: string; deleted: boolean; recurrence?: string[];
}
export interface CalendarOccurrence extends CalendarItem { occurrenceId: string }
export interface CalendarGoogleStatus { configured: boolean; connected: boolean; name: string; redirectUri: string }
export interface CalendarGoogleConfig { clientId: string; clientSecret: string; redirectUri: string }
export interface CalendarSnapshot { collections: CalendarCollection[]; items: CalendarItem[]; occurrences: CalendarOccurrence[]; google: CalendarGoogleStatus; googleError?: string }
export interface CalendarChange { action: 'save' | 'delete' | 'restore' | 'complete' | 'collection'; item?: CalendarItem; collection?: CalendarCollection; id?: string; revision?: string }
export interface CalendarNotice { id: string; title: string; body: string }
export type CalendarGoogleAction = 'configure' | 'connect' | 'disconnect';
export interface CalendarGoogleResult { status?: CalendarGoogleStatus; url?: string }
