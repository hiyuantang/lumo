// SPDX-License-Identifier: AGPL-3.0-only
export function PetPlayBall() {
  return <svg className="pet-play-ball" data-testid="pet-play-ball" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="#51445c" strokeWidth="1.2">
    <g className="pet-golf-ball"><circle cx="10" cy="10" r="8.8" fill="#fff9ef"/><g fill="#d9d4cb" stroke="none"><circle cx="7" cy="6" r=".8"/><circle cx="12" cy="5" r=".8"/><circle cx="5" cy="11" r=".8"/><circle cx="10" cy="10" r=".8"/><circle cx="14" cy="12" r=".8"/><circle cx="9" cy="15" r=".8"/></g></g>
    <g className="pet-basketball-ball"><circle cx="10" cy="10" r="8.8" fill="#ff9949"/><path d="M1.2 10 H18.8 M10 1.2 V18.8 M4 3 Q12 10 4 17 M16 3 Q8 10 16 17"/></g>
  </svg>;
}

export function PetPastimes() {
  return <svg className="pet-sketch pet-pastimes" viewBox="0 0 96 96" fill="none" stroke="#51445c" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <g className="pet-pastime-prop pet-reading-prop"><path d="M48 66 Q35 60 23 63 L27 82 Q39 80 48 86 Q57 80 69 82 L73 63 Q61 60 48 66 Z" fill="#fff5da"/><path d="M48 66 V86 M30 68 L41 70 M31 73 L42 75 M55 70 L66 68 M54 75 L65 73"/><path className="pet-book-page" d="M48 66 Q60 62 69 65 L63 78 Q55 79 48 86" fill="#ffcf69"/></g>
    <g className="pet-pastime-prop pet-golf-prop"><g className="pet-golf-club"><path d="M69 55 L83 89" strokeWidth="2.7"/><path d="M80 87 Q89 84 92 88 L91 92 L83 92 Z" fill="#a5bdc9"/><path d="M67 51 L71 60" stroke="#8a5bd4" strokeWidth="4"/></g></g>
    <g className="pet-pastime-prop pet-basketball-prop"><path d="M76 68 Q86 66 90 71 M85 68 L88 75 M88 69 L92 74" stroke="var(--pet-limb)" strokeWidth="1.8"/></g>
    <g className="pet-pastime-prop pet-painting-prop"><path d="M73 35 L63 94 M73 35 L94 94 M70 77 H90" stroke="#bc8a59" strokeWidth="3"/><path d="M66 40 L87 40 L91 74 L63 74 Z" fill="#fff5da"/><path className="pet-painted-stroke" d="M70 62 Q74 49 82 55 Q87 60 78 67" stroke="#1ac7d8" strokeWidth="4"/><path d="M26 65 Q16 69 23 78 Q32 84 36 76 Q33 73 37 70 Q37 63 26 65 Z" fill="#bf8c62"/><circle cx="24" cy="71" r="2" fill="#ff5b95" stroke="none"/><circle cx="30" cy="76" r="2" fill="#ffd12a" stroke="none"/><path className="pet-paintbrush" d="M62 63 L76 53 M74 52 L78 52 L77 56" stroke="#a66aff" strokeWidth="2.5"/></g>
    <g className="pet-pastime-prop pet-drums-prop"><path d="M22 70 L25 86 Q48 95 71 86 L74 70" fill="#a66aff"/><ellipse cx="48" cy="70" rx="26" ry="8" fill="#fff5da"/><path d="M27 77 L33 85 L40 79 L47 88 L55 80 L64 86 L70 76" stroke="#ffcf69"/><path className="pet-drumstick-left" d="M21 57 L43 70" stroke="#bc8a59" strokeWidth="3"/><path className="pet-drumstick-right" d="M74 55 L52 70" stroke="#bc8a59" strokeWidth="3"/></g>
    <g className="pet-pastime-prop pet-bubbles-prop"><path d="M24 72 V86 Q30 90 36 86 V72 Z" fill="#a5d9ea"/><ellipse cx="30" cy="72" rx="6" ry="2" fill="#8a5bd4"/><g className="pet-bubble-wand"><path d="M73 59 L67 49" stroke="#8a5bd4" strokeWidth="2.5"/><circle cx="64" cy="44" r="6" stroke="#8a5bd4" strokeWidth="2"/></g><g className="pet-play-bubble pet-play-bubble-one"><circle r="8" fill="#a5d9ea" fillOpacity=".35" stroke="#64b0d1"/><path d="M-4 -2 Q-3 -5 0 -5" stroke="#fff5da"/></g><g className="pet-play-bubble pet-play-bubble-two"><circle r="5" fill="#efb5df" fillOpacity=".35" stroke="#c980b1"/><path d="M-2 -2 L0 -3" stroke="#fff5da"/></g></g>
  </svg>;
}
