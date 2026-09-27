# Lumo — Design Principles

## Feeling

1. The macOS inspiration is **behavioral, never visual copying**. The
   feeling comes from calm interaction, hierarchy, consistency and
   animation — not from reproducing Apple assets pixel-for-pixel.
2. The desktop is calm: a real desktop, not a dashboard. Motion and
   color exist to explain state, never to decorate.
3. Hierarchy is explicit: the menu bar, windows, dock and notification
   center each have one clear role and one clear visual level.
4. Consistency is binding: the same action looks, behaves and is named
   the same way in every application.

## Originality rules

Lumo ships its own product name and logo, wallpaper, color system,
icon set, typography, window controls, sound and animation language, and
application names. The following rules are binding for every UI task:

1. **UI font:** Inter (SIL OFL) with a system-ui fallback stack. Never
   San Francisco, never SF Symbols.
2. **Window controls:** left-aligned circular controls in coral, amber and
   green. Use 14px matte circles with bold 11px action glyphs on hover
   and keyboard focus.
3. **Accent palette:** neutral white, silver, charcoal and near-black
   surfaces. Rich color belongs to app icons, file glyphs and semantic status.
4. **Icons:** original generated artwork for app identities and inline SVG
   for interface actions. Never Apple assets or copied third-party icon packs.

## Interaction rules

The current surface treatment follows the public macOS 27 direction:
clearer glass, rounded window geometry, consistent toolbars and full-height
sidebars. Lumo retains its original assets, typography, icons, palette and
window controls. See [DESKTOP_STYLE.md](DESKTOP_STYLE.md) for the visual
system and generated-wallpaper provenance.

1. All shell interaction renders locally in the browser with **zero
   server round trips**: moving a window, opening a menu or switching
   applications never touches the network.
2. Small transitions use 140–220 ms ease-out. Window minimize and dock
   layout transitions use their coordinated longer timings. Nothing bounces.
3. Every destructive action confirms before it executes.
4. Markdown editing and preview render locally. Typing, scrolling and
   preview updates require no server round trip; explicit file operations
   use the authenticated data-source interface. Preserve local edits when
   a save fails, and warn before discarding unsaved work.

## Accessibility

1. All key operations are reachable by keyboard.
2. Focus is always visible.
3. ARIA roles are applied to windows, the dock and menus.
4. `prefers-reduced-motion` is honored, and a manual reduced-motion
   setting is provided alongside it.
5. Light and dark themes both meet WCAG AA contrast.
