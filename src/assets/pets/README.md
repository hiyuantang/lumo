# Lumo pet artwork

Triangle, Pebble, Square and Diamond are original geometric characters in
`src/shell/PetSprite.tsx`, with sketch-like SVG arms and legs and a minimal face.
Shape and coat color are independent preferences. The old animal characters are
replaced by Triangle when a saved character is no longer available.

The visual fur reference is https://feralui.dev/fur. Lumo's implementation in
`src/shell/PetFur.tsx` is independently authored from the visual reference; it
uses no third-party source, packages, textures or character assets. A seeded
strand field follows each silhouette, with shaded roots and fine light tips.
A canvas renders at twice the display pixel density, with a minimum of three
pixels per CSS pixel, to keep fine strands crisp at desktop and settings sizes.
It redraws when browser zoom or monitor pixel density changes.

Hovering strokes the coat. A local spring animation restores disturbed strands,
then stops requesting frames. Fur does not animate while dragging, in settings
previews, or with reduced motion. CSS handles breathing, dangling limbs, blinking,
writing, hopping and waving without per-frame React updates or server requests.
Reduced motion keeps distinct working and completion poses.

`src/shell/petMotion.ts` defines original local physics and randomized behavior;
`src/shell/usePetMotion.ts` connects it to the measured dock and the desktop.
Movement poses share the same artwork. Stride tracks distance; direction mirrors
the character, and climbing alternates limbs. Pickup samples pointer momentum
and adds a tilt; release follows a gravity arc with damped rebounds and friction.
Landing briefly squashes the body and releases small sketch dust marks; fast
throws add short sketch trails. Holding still before release clears the throw
momentum. Rest and
hidden-page suspension avoid an idle frame loop. Free mode preserves placement.

`src/shell/PetMagic.tsx` supplies original vector props: a wand, notebook,
soccer ball, juggling stars and a striped climbing pole. Brief routines conjure,
use and dismiss props. Edge climbing alternates grips before pulling over the
dock lip; pole climbing keeps the prop planted before hopping onto the dock.
Reduced motion shows stationary activity poses and disables effects.
