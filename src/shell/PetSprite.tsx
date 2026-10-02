// SPDX-License-Identifier: AGPL-3.0-only
import { PetFur } from './PetFur';
import { PetMagicPole, PetMagicProps, PetClimbArms } from './PetMagic';
import { PetPastimes } from './PetPastimes';
import type { PetCoat, PetKind, PetMood } from './pet';
import '../styles/pet.css';

export function PetSprite({ kind, coat = 'citrus', mood = 'idle', interactive = false, paused = false }: { kind: PetKind; coat?: PetCoat; mood?: PetMood; interactive?: boolean; paused?: boolean }) {
  return <div aria-hidden="true" className={`pet-sprite pet-${kind} pet-${mood}`}>
    <svg className="pet-sketch" viewBox="0 0 96 96" fill="none"><ellipse className="pet-ground" cx="48" cy="89" rx="22" ry="2.5"/></svg>
    <PetMagicPole/>
    <div className="pet-facing">
    <svg className="pet-sketch pet-flight-trails" viewBox="0 0 96 96" fill="none" stroke="var(--pet-limb)" strokeWidth="1" strokeLinecap="round"><path d="M-10 37 L6 37 M-15 49 L2 49 M-8 61 L7 61"/></svg>
    <div className="pet-body">
      <svg className="pet-sketch pet-limbs" viewBox="0 0 96 96" fill="none" stroke="var(--pet-limb)" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
        <g className="pet-leg-left"><path d="M37 69 Q33 79 35 87 Q31 89 26 88 M36 72 Q34 80 36 86"/></g>
        <g className="pet-leg-right"><path d="M59 69 Q63 77 61 87 Q65 89 70 87 M60 72 Q62 80 60 85"/></g>
        <g className="pet-arm-left"><path d="M25 51 Q12 52 12 66 L9 68 M13 64 L15 68 M12 65 L12 70 M23 53 Q14 54 13 61"/></g>
        <g className="pet-arm-right">
          <path className="pet-arm-rest" d="M71 51 Q84 53 83 65 L87 68 M83 64 L81 69 M83 65 L84 70 M73 53 Q82 55 82 61"/>
          <path className="pet-arm-wave" d="M71 51 Q82 48 83 35 L87 31 M83 35 L81 30 M83 34 L84 28 M74 49 Q80 45 81 39"/>
        </g>
        <PetClimbArms/>
      </svg>
      <PetFur kind={kind} coat={coat} interactive={interactive} paused={paused}/>
      <svg className="pet-sketch pet-details" viewBox="0 0 96 96" fill="none" stroke="var(--pet-ink)" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
        <g className="pet-face">
          <g className="pet-eyes" fill="#222127" stroke="none"><ellipse cx="40" cy="48" rx="2.6" ry="3.7"/><ellipse cx="56" cy="48" rx="2.6" ry="3.7"/><g fill="#fff"><circle cx="40.7" cy="46.8" r=".75"/><circle cx="56.7" cy="46.8" r=".75"/></g></g>
          <path className="pet-mouth-rest" d="M45 56 Q48 58 51 56"/>
          <path className="pet-mouth-happy" d="M44 55 Q48 63 52 55"/>
        </g>
        <g className="pet-work-prop pet-notebook"><path d="M33 62 L59 64 L57 80 L31 78 Z" fill="var(--pet-paper)"/><path d="M38 67 L53 68 M37 71 L51 72 M36 75 L46 76" strokeWidth="1"/></g>
        <path className="pet-pencil" d="M63 60 L52 72 M62 59 L64 61" stroke="#52505b" strokeWidth="2"/>
        <g className="pet-sparkles" stroke="var(--pet-spark)"><path d="M15 20 L15 28 M11 24 L19 24 M78 15 L78 23 M74 19 L82 19 M85 58 L85 64 M82 61 L88 61"/></g>
        <g className="pet-thoughts" fill="var(--pet-ink)" stroke="none"><circle cx="69" cy="20" r="1.5"/><circle cx="75" cy="15" r="1.7"/><circle cx="82" cy="13" r="2"/></g>
      </svg>
    </div>
    <PetMagicProps/>
    <PetPastimes/>
    <svg className="pet-sketch pet-motion-effects" viewBox="0 0 96 96" fill="none" stroke="var(--pet-limb)" strokeWidth="1" strokeLinecap="round"><g className="pet-pickup-effects"><path d="M17 29 L13 25 M79 29 L83 25 M48 9 L48 5"/></g><g className="pet-landing-effects"><path d="M19 88 L12 86 M77 88 L84 86 M22 91 L17 94 M74 91 L79 94"/><ellipse cx="48" cy="89" rx="29" ry="3"/></g></svg>
    </div>
  </div>;
}
