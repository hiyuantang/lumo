// SPDX-License-Identifier: AGPL-3.0-only
import { useId, useState, type ReactNode } from 'react';
import { IconChevronRight } from './icons';
import '../styles/disclosure.css';

export function DisclosureTrigger({ label, expanded, controls, onToggle }: { label: ReactNode; expanded: boolean; controls: string; onToggle: () => void }) {
  return <button type="button" className="disclosure-trigger" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}><IconChevronRight size={14}/><span className="disclosure-label">{label}</span></button>;
}

export function DisclosureBody({ id, expanded, children }: { id: string; expanded: boolean; children: ReactNode }) {
  return <div id={id} className={`disclosure-body${expanded ? ' is-open' : ''}`} aria-hidden={!expanded} {...(!expanded ? { inert: '' } : {})}><div className="disclosure-content">{children}</div></div>;
}

export function Disclosure({ label, children, className = '', testId, expanded, onExpandedChange }: { expanded?: boolean; onExpandedChange?: (open: boolean) => void; label: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  const [localOpen, setOpen] = useState(false);
  const open = expanded ?? localOpen;
  const id = useId();
  return <div className={`disclosure ${className}`} data-testid={testId}>
    <DisclosureTrigger label={label} expanded={open} controls={id} onToggle={() => { setOpen(!open); onExpandedChange?.(!open); }}/>
    <DisclosureBody id={id} expanded={open}>{children}</DisclosureBody>
  </div>;
}
