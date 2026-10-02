// SPDX-License-Identifier: AGPL-3.0-only
export const PET_ACTIVITIES = [
  { value: 'notes', label: 'Take notes' },
  { value: 'soccer', label: 'Play soccer' },
  { value: 'juggle', label: 'Juggle stars' },
  { value: 'reading', label: 'Read a book' },
  { value: 'golf', label: 'Play golf' },
  { value: 'basketball', label: 'Play basketball' },
  { value: 'painting', label: 'Paint' },
  { value: 'drums', label: 'Play drums' },
  { value: 'bubbles', label: 'Blow bubbles' },
] as const;
export type PetTrick = typeof PET_ACTIVITIES[number]['value'];
