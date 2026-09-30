// SPDX-License-Identifier: AGPL-3.0-only
import type { InputHTMLAttributes } from 'react';

export function Checkbox({ onChange, className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & { onChange: (checked: boolean) => void }) {
  return <input {...props} type="checkbox" className={`app-checkbox ${className}`} onChange={(event) => onChange(event.target.checked)} />;
}
