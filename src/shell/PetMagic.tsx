// SPDX-License-Identifier: AGPL-3.0-only
function Star({ color }: { color: string }) {
  return <path d="M0 -6 L1.8 -1.8 L6 0 L1.8 1.8 L0 6 L-1.8 1.8 L-6 0 L-1.8 -1.8 Z" fill={color} stroke="#51445c" strokeWidth=".8"/>;
}

export function PetMagicPole() {
  return <svg className="pet-magic-pole" viewBox="0 0 12 100" preserveAspectRatio="none" fill="none" aria-hidden="true">
    <path d="M6 4 Q5 48 6 97" stroke="#51445c" strokeWidth="4" vectorEffect="non-scaling-stroke"/>
    <path d="M6 4 Q5 48 6 97" stroke="#ac7bff" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>
    <path d="M4 18 L8 15 M4 35 L8 32 M4 52 L8 49 M4 69 L8 66 M4 86 L8 83" stroke="#ffe167" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
    <path d="M2 98 L10 98" stroke="var(--pet-limb)" strokeWidth="1.2" vectorEffect="non-scaling-stroke"/>
    <circle cx="6" cy="3" r="2.5" fill="#ffe167" stroke="#51445c" strokeWidth=".8"/>
  </svg>;
}

export function PetClimbArms() {
  return <g className="pet-climb-arms">
    <g className="pet-climb-arm-back"><path d="M26 53 Q46 39 79 40 L86 39 M85 38 L88 38 M85 40 L88 40 M85 42 L88 42"/></g>
    <g className="pet-climb-arm-front"><path d="M70 49 Q79 47 82 32 L87 31 M86 30 L89 30 M86 32 L89 32 M86 34 L89 34"/></g>
  </g>;
}

export function PetMagicProps() {
  return <svg className="pet-sketch pet-magic-props" viewBox="0 0 96 96" fill="none" stroke="#51445c" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <g className="pet-wand"><path d="M73 42 L91 24" stroke="#51445c" strokeWidth="3.5"/><path d="M86 29 L91 24" stroke="#fff9e9" strokeWidth="3.5"/></g>
    <g className="pet-conjure-stars"><g transform="translate(87 18)"><Star color="#ffe167"/></g><g transform="translate(67 25) scale(.6)"><Star color="#ac7bff"/></g><g transform="translate(89 50) scale(.5)"><Star color="#ff8a61"/></g><path d="M71 16 L73 12 M93 35 L96 36 M60 32 L57 30" stroke="#ac7bff"/></g>
    <g className="pet-soccer-prop"><g className="pet-soccer-ball"><circle r="8" fill="#fff9ef"/><path d="M0 -4 L3.8 -1.2 L2.4 3.2 L-2.4 3.2 L-3.8 -1.2 Z M-7 -4 L-4 -6 L-3 -4 M5 -5 L7 -2 L5 -1 M4 6 L1 7 L0 5 M-6 4 L-7 1 L-5 0" fill="#51445c" strokeWidth=".6"/></g></g>
    <g className="pet-juggle-prop"><g className="pet-juggle-star pet-juggle-one"><Star color="#ffe167"/></g><g className="pet-juggle-star pet-juggle-two"><Star color="#ac7bff"/></g><g className="pet-juggle-star pet-juggle-three"><Star color="#ff8a61"/></g></g>
  </svg>;
}
