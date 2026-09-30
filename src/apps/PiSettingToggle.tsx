// SPDX-License-Identifier: AGPL-3.0-only
import { Checkbox } from '../shell/Checkbox';

export function PiSettingToggle({ label, description, checked, disabled, onChange, testId, ariaLabel }: { label: string; description?: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; testId?: string; ariaLabel?: string }) {
  return <div className="pi-settings-toggle"><span><strong>{label}</strong>{description && <small>{description}</small>}</span><Checkbox role="switch" aria-label={ariaLabel ?? label} data-testid={testId} checked={checked} disabled={disabled} onChange={onChange}/></div>;
}
