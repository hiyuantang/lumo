# Lumo pet artwork

Cat, Fox and Robot are original vector characters drawn in
`src/shell/PetSprite.tsx`. Their shapes are authored for Lumo, with no third-party
character references, raster assets or animation libraries.

`src/styles/pet.css` animates individual SVG parts continuously: body, head, eyes,
ears, tail and paws. Working adds a notepad and writing motion; completion adds
hopping, waving and sparkles. The browser runs the animations locally without
per-frame application state updates or server requests.

Dragging pauses motion. Reduced motion preserves distinct poses while disabling
repeating movement. Settings use the same vector component for character previews.
