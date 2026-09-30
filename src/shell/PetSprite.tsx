// SPDX-License-Identifier: AGPL-3.0-only
import type { PetKind, PetMood } from './pet';
import '../styles/pet.css';

export function PetSprite({ kind, mood = 'idle' }: { kind: PetKind; mood?: PetMood }) {
  const robot = kind === 'robot';
  return <svg aria-hidden="true" className={`pet-sprite pet-${kind} pet-${mood}`} viewBox="0 0 96 96" fill="none">
    <ellipse className="pet-ground" cx="48" cy="87" rx="24" ry="3"/>
    <g className="pet-body" stroke="var(--pet-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {!robot && <g className="pet-tail">{kind === 'fox' ? <><path d="M64 78C82 82 92 69 83 51c-1 12-12 10-19 18Z" fill="var(--pet-coat)"/><path d="M83 51c4 8 5 15 1 21l-8-6c4-3 6-7 7-15Z" fill="var(--pet-light)" stroke="none"/></> : <path d="M66 79c17 1 20-10 13-19" stroke="var(--pet-coat)" strokeWidth="9"/>}</g>}
      <g className="pet-feet" fill="var(--pet-coat)"><path d="M34 77v6c-6 1-7 6-1 6h10V77Z"/><path d="M53 77v12h10c6 0 5-5-1-6v-6Z"/></g>
      <path d="M31 58c0-9 34-9 34 0l4 19c1 11-43 11-42 0Z" fill="var(--pet-coat)"/>
      {robot ? <><rect x="36" y="60" width="24" height="17" rx="5" fill="var(--pet-light)"/><path d="M42 67h12" stroke="var(--pet-mark)"/><circle className="pet-status-light" cx="48" cy="72" r="2" fill="var(--pet-mark)" stroke="none"/></> : <ellipse cx="48" cy="69" rx="13" ry="14" fill="var(--pet-light)" stroke="none"/>}
      <g className="pet-arm pet-arm-left"><path d="M30 59c-7 2-10 8-7 13 2 3 6 1 8-2" fill="var(--pet-coat)"/><circle cx="25" cy="71" r="3" fill="var(--pet-light)" stroke="none"/></g>
      <g className="pet-work-prop"><rect x="36" y="61" width="23" height="20" rx="3" fill="var(--pet-paper)"/><path d="M42 67h11M42 72h8M42 77h10" stroke="var(--pet-mark)" strokeWidth="1.3"/></g>
      <g className="pet-head">
        {robot ? <><path className="pet-antenna" d="M48 20v-8"/><circle className="pet-antenna" cx="48" cy="9" r="4" fill="var(--pet-mark)"/><rect x="17" y="32" width="7" height="15" rx="3" fill="var(--pet-mark)"/><rect x="72" y="32" width="7" height="15" rx="3" fill="var(--pet-mark)"/><rect x="22" y="20" width="52" height="38" rx="14" fill="var(--pet-coat)"/><rect x="28" y="27" width="40" height="24" rx="9" fill="var(--pet-light)"/></> : <><g className="pet-ear pet-ear-left"><path d="M24 33 21 12c0-3 16 7 20 14Z" fill="var(--pet-coat)"/><path d="m26 26-2-9 10 9" fill="var(--pet-mark)" stroke="none"/></g><g className="pet-ear pet-ear-right"><path d="m55 26 18-14c3-2 1 18-1 23Z" fill="var(--pet-coat)"/><path d="m62 27 9-10-1 12" fill="var(--pet-mark)" stroke="none"/></g><path d="M22 39c0-24 52-24 52 0 0 16-12 23-26 23S22 55 22 39Z" fill="var(--pet-coat)"/><path d={kind === 'fox' ? 'M23 40c8 0 16 4 25 11 9-7 17-11 25-11-1 14-12 21-25 21S24 54 23 40Z' : 'M32 48c0-9 12-8 16-3 4-5 16-6 16 3 0 8-9 12-16 12s-16-4-16-12Z'} fill="var(--pet-light)" stroke="none"/>{kind === 'cat' && <path d="m37 25 3 6m8-7v6m11-5-3 6" stroke="var(--pet-mark)" strokeWidth="2.5"/>}</>}
        <g className="pet-eyes" fill="var(--pet-ink)" stroke="none"><ellipse cx="37" cy="39" rx="3.2" ry="4.2"/><ellipse cx="59" cy="39" rx="3.2" ry="4.2"/><circle cx="38" cy="37.8" r=".9" fill="var(--pet-paper)"/><circle cx="60" cy="37.8" r=".9" fill="var(--pet-paper)"/></g>
        {!robot && <path d="m45 47 3 2 3-2Z" fill="var(--pet-mark)" stroke="none"/>}
        <path className="pet-mouth-rest" d={robot ? 'M43 45q5 4 10 0' : 'M43 51q3 3 5 0 2 3 5 0'} strokeWidth="1.4"/>
        <path className="pet-mouth-happy" d="M42 48q6 11 12 0Z" fill="var(--pet-ink)" strokeWidth="1.2"/>
        <g className="pet-cheeks" fill="var(--pet-mark)" stroke="none" opacity=".35"><ellipse cx="29" cy="46" rx="3" ry="1.8"/><ellipse cx="67" cy="46" rx="3" ry="1.8"/></g>
      </g>
      <g className="pet-arm pet-arm-right"><g className="pet-arm-rest"><path d="M67 58c8 3 12 9 9 14-2 3-6 1-8-2" fill="var(--pet-coat)"/><circle cx="73" cy="71" r="3" fill="var(--pet-light)" stroke="none"/><path className="pet-pencil" d="m72 68 6 9" stroke="var(--pet-mark)" strokeWidth="3"/></g><g className="pet-arm-wave"><path d="M67 58c7-2 12-9 13-16 1-5-6-7-8-2l-3 9" fill="var(--pet-coat)"/><circle cx="77" cy="41" r="2.5" fill="var(--pet-light)" stroke="none"/></g></g>
    </g>
    <g className="pet-sparkles" stroke="var(--pet-mark)" strokeWidth="2" strokeLinecap="round"><path d="M12 27v8m-4-4h8M83 22v8m-4-4h8M78 8v4m-2-2h4"/></g>
    <g className="pet-thoughts" fill="var(--pet-mark)"><circle cx="78" cy="19" r="2"/><circle cx="85" cy="15" r="2"/><circle cx="91" cy="11" r="2"/></g>
  </svg>;
}
