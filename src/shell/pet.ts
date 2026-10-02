// SPDX-License-Identifier: AGPL-3.0-only
import { useAppPreference } from './useAppState';
import { PET_ACTIVITIES, type PetTrick } from './petActivities';

export const PETS = [{ value: 'triangle', label: 'Triangle' }, { value: 'pebble', label: 'Pebble' }, { value: 'square', label: 'Square' }, { value: 'diamond', label: 'Diamond' }] as const;
export type PetKind = typeof PETS[number]['value'];
export const PET_COATS = [{ value: 'butter', label: 'Butter', color: '#ffd12a' }, { value: 'citrus', label: 'Citrus', color: '#a9e51c' }, { value: 'rose', label: 'Rose', color: '#ff5b95' }, { value: 'lagoon', label: 'Lagoon', color: '#1ac7d8' }, { value: 'tangerine', label: 'Tangerine', color: '#ff8a2a' }, { value: 'lilac', label: 'Lilac', color: '#a66aff' }, { value: 'cream', label: 'Cream', color: '#ffe4a3' }] as const;
export type PetCoat = typeof PET_COATS[number]['value'];
export type PetMood = 'idle' | 'working' | 'done';
export const PET_POSITION_RESET = 'lumo-pet-position-reset';
export const PET_BUBBLE_PREVIEW = 'lumo-pet-bubble-preview';

export function usePetPreferences() {
  const [enabled, setEnabled] = useAppPreference<boolean>('desktop', 'pet-enabled', true);
  const [kind, setKind] = useAppPreference<PetKind>('desktop', 'pet-kind', 'triangle', PETS.map((item) => item.value));
  const [coat, setCoat] = useAppPreference<PetCoat>('desktop', 'pet-coat', 'citrus', PET_COATS.map((item) => item.value));
  const [gravity, setGravity] = useAppPreference<boolean>('desktop', 'pet-gravity', false);
  const [bubbles, setBubbles] = useAppPreference<boolean>('desktop', 'pet-bubbles', true);
  const [position, setPosition] = useAppPreference<string>('desktop', 'pet-position', '');
  const [disabledActivities, setDisabledActivities] = useAppPreference<string[]>('desktop', 'pet-disabled-activities', []);
  const activities = PET_ACTIVITIES.filter((item) => !disabledActivities.includes(item.value)).map((item) => item.value);
  const setActivity = (activity: PetTrick, enabled: boolean) => setDisabledActivities((items) => enabled ? items.filter((item) => item !== activity) : [...new Set([...items, activity])]);
  return { enabled, setEnabled, kind, setKind, coat, setCoat, gravity, setGravity, bubbles, setBubbles, position, setPosition, activities, setActivity };
}

export function petPosition(raw: string) {
  try {
    const value = JSON.parse(raw);
    if (Number.isFinite(value.x) && Number.isFinite(value.y)) return { x: Math.max(0, Math.min(1, value.x)), y: Math.max(0, Math.min(1, value.y)), desktop: value.area === 'desktop' };
  } catch {}
  return { x: 0.94, y: 1, desktop: false };
}
