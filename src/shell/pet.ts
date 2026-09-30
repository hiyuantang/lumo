// SPDX-License-Identifier: AGPL-3.0-only
import { useAppPreference } from './useAppState';

export const PETS = [{ value: 'cat', label: 'Cat' }, { value: 'fox', label: 'Fox' }, { value: 'robot', label: 'Robot' }] as const;
export type PetKind = typeof PETS[number]['value'];
export type PetMood = 'idle' | 'working' | 'done';
export const PET_BUBBLE_PREVIEW = 'lumo-pet-bubble-preview';

export function usePetPreferences() {
  const [enabled, setEnabled] = useAppPreference<boolean>('desktop', 'pet-enabled', true);
  const [kind, setKind] = useAppPreference<PetKind>('desktop', 'pet-kind', 'cat', ['cat', 'fox', 'robot']);
  const [bubbles, setBubbles] = useAppPreference<boolean>('desktop', 'pet-bubbles', true);
  const [position, setPosition] = useAppPreference<string>('desktop', 'pet-position', '');
  return { enabled, setEnabled, kind, setKind, bubbles, setBubbles, position, setPosition };
}

export function petPosition(raw: string) {
  try {
    const value = JSON.parse(raw);
    if (Number.isFinite(value.x) && Number.isFinite(value.y)) return { x: Math.max(0, Math.min(1, value.x)), y: Math.max(0, Math.min(1, value.y)) };
  } catch {}
  return { x: 0.94, y: 1 };
}
