// SPDX-License-Identifier: AGPL-3.0-only
import { Select } from '../shell/Select';
import { PetSprite } from '../shell/PetSprite';
import { PETS, PET_COATS, PET_POSITION_RESET, PET_BUBBLE_PREVIEW, usePetPreferences, type PetCoat, type PetKind } from '../shell/pet';
import { PiSettingToggle } from './PiSettingToggle';
import { PET_ACTIVITIES } from '../shell/petActivities';

export function PiPetSettings() {
  const pet = usePetPreferences();
  return <div className="pi-settings-scroll pi-pet-settings"><section aria-label="Pet settings" data-testid="settings-pet">
    <h2>Pet</h2>
    <div className="pi-extension-list">
      <div className="pi-extension-item"><PiSettingToggle label="Desktop pet" description="Drag to move. Use arrow keys when focused." testId="settings-pet-enabled" checked={pet.enabled} onChange={pet.setEnabled}/></div>
      <div className="pi-extension-item"><div className="pi-settings-toggle"><strong>Shape</strong><div className="pi-pet-character"><PetSprite kind={pet.kind} coat={pet.coat}/><Select aria-label="Pet shape" data-testid="settings-pet-character" value={pet.kind} options={PETS.map(({ value, label }) => ({ value, label }))} onChange={(value) => pet.setKind(value as PetKind)}/></div></div></div>
      <div className="pi-extension-item"><div className="pi-settings-toggle"><strong>Coat</strong><div className="pi-pet-coat"><span className="pi-pet-coat-swatch" style={{ backgroundColor: PET_COATS.find((item) => item.value === pet.coat)!.color }} aria-hidden="true"/><Select aria-label="Pet coat color" data-testid="settings-pet-coat" value={pet.coat} options={PET_COATS.map(({ value, label }) => ({ value, label }))} onChange={(value) => pet.setCoat(value as PetCoat)}/></div></div></div>
      <div className="pi-extension-item"><PiSettingToggle label="Gravity" description="Roam on the dock. Off: stay where placed." testId="settings-pet-gravity" checked={pet.gravity} disabled={!pet.enabled} onChange={pet.setGravity}/></div>
      <div className="pi-extension-item"><PiSettingToggle label="Completion bubbles" testId="settings-pet-bubbles" checked={pet.bubbles} disabled={!pet.enabled} onChange={(enabled) => { pet.setBubbles(enabled); if (enabled) window.dispatchEvent(new Event(PET_BUBBLE_PREVIEW)); }}/></div>
      <div className="pi-extension-item"><div className="pi-settings-toggle"><strong>Position</strong><button type="button" className="btn" data-testid="settings-pet-reset" disabled={!pet.enabled} onClick={() => { pet.setPosition(''); window.dispatchEvent(new Event(PET_POSITION_RESET)); }}>Reset</button></div></div>
    </div>
    <h3>Activities</h3>
    <div className="pi-extension-list pi-pet-activities" data-testid="settings-pet-activities">
      {PET_ACTIVITIES.map((activity) => <div className="pi-extension-item" key={activity.value}><PiSettingToggle label={activity.label} testId={`settings-pet-activity-${activity.value}`} checked={pet.activities.includes(activity.value)} disabled={!pet.enabled} onChange={(enabled) => pet.setActivity(activity.value, enabled)}/></div>)}
    </div>
  </section></div>;
}
