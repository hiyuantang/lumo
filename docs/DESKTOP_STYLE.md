# Lumo — Desktop Style

## Direction

Lumo uses a neutral, high-contrast desktop with matte controls, vivid app
icons and quiet, fluid motion. Light mode uses true white content, silver
toolbars and grey sidebars. Dark mode uses near-black content and charcoal
chrome. Inter, original SVG glyphs and browser-native interaction remain
the foundation. No third-party implementation code or assets are used.

## Shared visual system

- Light: content `#ffffff`, grouped surfaces `#f5f5f5`, text `#191919`.
- Dark: content `#161616`, grouped surfaces `#202020`, sidebar near
  `#121212`, text `#f5f5f5`.
- Neutral shadows and fine borders separate windows, menus and panels.
- Content-row dividers stop short of both edges, aligned to the surrounding
  content padding (normally 16px). Preserve already-inset separators. Window,
  toolbar and sidebar boundaries retain their structural borders.
- Files lists use a uniform background. Hover uses an inset rounded neutral
  fill; selected rows use the stronger neutral accent with contrasting text
  and icons. Row highlights have 3px vertical and 8px horizontal margins, keeping
  them clear of headers and neighboring rows while text stays aligned with
  column headings. The path copy action uses the shared copy icon and tooltip.
- Matte buttons use opaque neutral fills and fine borders, without gradients,
  inset highlights or bevel shadows. Labels use 13px medium-weight type.
  Hover changes the fill; pressing moves the button by one pixel.
  Primary buttons retain dark text on a pale neutral surface in both themes.
- Standard text and icon buttons share a 32px height; icon buttons are square.
  Compact button groups use one shared height for all their controls. Fields
  and selectors share a 34px height. Use the shared size tokens and horizontal
  padding; responsive labels must not add vertical padding or stretch icons.
- Window controls are 14px matte circles at the top left, ordered close,
  minimize, maximize/restore. Coral, amber and green distinguish actions.
  Bold 11px glyphs appear on group hover or individual keyboard focus.
  An invisible three-pixel extension keeps the pointer targets comfortable.
  Inactive controls become grey; all controls retain accessible names.
- Original app artwork is shared between Dock tiles, minimized-window badges
  and App Library. Ivory tiles with colorful objects alternate with blue,
  indigo and graphite tiles. Large filled shapes and restrained dimensional
  shading keep each application recognizable at dock size.
- Menu and selector choices use a checkmark in a fixed right column as their only
  persistent selection indicator. A neutral accent background and contrasting
  text highlight only the hovered or keyboard-active row, never the selected
  value by itself. Secondary labels inherit the highlighted text color.
- App menus dismiss on pointer, touch, focus or wheel interaction outside
  the menu navigation. Dismissal does not swallow the underlying action;
  the same click can select a file, use a toolbar button or focus a window.
- Refresh is a compact control in the left list panel or resource card header;
  it does not get a dedicated full-width toolbar. Search belongs in the header
  of the list it filters. App updates are available through “Check for Updates…”
  in the top-left app menu, with updates handled in App Library.
- Checkmarks, checkboxes and other app selection controls sit to the right of
  their left-aligned labels, in a consistent trailing column.
- Checkbox rows and descriptions do not toggle their control. Only the checkbox
  hit target and normal keyboard activation change it; inputs retain accessible
  names without a whole-row activating label.
- Window corners: 18px; menus and sheets: 16px; controls: 8–10px.
- Compact 12.5–14px desktop type and the existing content hierarchy remain.
- Small transitions use 140–220 ms ease-out. Dock hover lifts four pixels;
  opening windows fade and settle over six pixels. Reduced motion disables
  these transitions through the existing system and manual preferences.
- The wallpaper is a bundled static WebP. Dark mode multiplies the same
  neutral artwork with `#292929`, avoiding another download or animation.

## App dialogs

Confirmations and file/folder pickers open inside their owning window, below
its title bar. They size to their content with a compact maximum width and
scroll inside the available window height. The owning app’s content is inert
until the dialog closes; other apps and the desktop remain usable. Nested
folder pickers restore focus to the calling dialog. Desktop Overview remains
a desktop-wide dialog.

## Window behavior

- All app title bars are 28px high, with vertically centered titles and controls.
- Controls run left to right: close, minimize, maximize/restore.
- Minimize shrinks the window into its own Dock icon; selecting that icon
  reverses the motion and restores the existing window, including its
  size, placement and app state. A window badge and Restore tooltip identify
  minimized apps. Clicking an already active Dock icon keeps its window open.
- Dock icons, thumbnails, padding and running indicators use a shared 90% scale.
  Minimized thumbnails use the available horizontal space before scrolling.
  Overview includes only desktop windows; minimized windows stay in the dock.
- Horizontal overscroll navigation is disabled at the page boundary to prevent
  accidental trackpad swipes from leaving the desktop. Browser navigation buttons
  and each app's own navigation controls remain available.
- Minimize and restore can reverse in flight. Reduced motion skips the
  animation, and viewport changes settle it immediately. Hidden windows
  leave the keyboard focus order; restoring returns focus to the last
  app control when it is still available.
- Drag a titlebar to move a window. Dragging a maximized or tiled window
  restores its previous floating size under the pointer. A small movement
  threshold keeps clicks and double-clicks from starting a drag.
- Drag to the left or right edge to preview half-width tiling; drag to
  the top edge to preview maximization. Release to apply, or press Escape
  to cancel and restore the starting layout. Pointer cancellation and
  leaving the browser during a drag also cancel the gesture.
- The Window menu provides the same tiling, maximize and restore actions.
  Half-width tiling is available only when the app's minimum size fits.
- Windows use the area below the menu bar and end at the top of the dock
  without an extra wallpaper gap. Maximizing, snapping, moving, resizing
  and restoring a saved layout all use this same area.
- Compact screens keep one active window above the dock; desktop tiling
  and resizing controls are unavailable at these widths.

## Design reference and generated asset provenance

The source specifications are this document and `DESIGN_PRINCIPLES.md`.
The original rationale is to separate quiet, neutral working surfaces
from recognizable, richly colored applications. Strong text contrast and
subtle depth make dense administration screens easier to scan.

The built-in Image Gen tool produced a two-state desktop concept and a
neutral adaptation of Lumo's existing original wallpaper on 2026-09-27.
The concept is a palette and material reference. The implementation retains
actual application copy, file data, window placement and navigation.
Circular controls at the top left and matte buttons supersede the concept's
right-aligned controls and black primary button. Dock labels remain tooltips.
Interactive text and controls are React and CSS; interface glyphs are
original SVG and app artwork is bundled raster media.

`src/assets/lumo-silver.webp` is encoded at quality 90 from the generated
1586 × 992 wallpaper, retaining its composition. The generation brief was:

> Edit the original Lumo wallpaper into a pure neutral monochrome light
> wallpaper. Preserve the broad flowing folded-satin composition and quiet
> negative space. Replace teal, green and gold with white, silver and grey,
> with no warm or cool cast. Use luminous white upper folds, silver creases
> and soft grey shadow contours. No UI, text, icons, logos or borders.

## App icon artwork

`src/assets/lumo-app-icons.webp` contains eleven original app icons generated
with the built-in Image Gen tool on 2026-09-27. The 1448 × 1086 transparent
atlas is encoded as WebP at quality 90 (about 184 KB), shared across all
instances. `AppIcon.tsx` selects each tile using an SVG viewport and clips
to a consistent rounded silhouette, excluding generation margins.

The design brief specified modern minimalist matte artwork with simple,
large, recognizable objects and subtle dimensional shading: coral waveform
Monitor, blue folder Files, landscape-card Preview, mint-on-graphite Terminal,
indigo code brackets, blue container cubes, cyan globe, four-color library,
coral and amber books, graphite gear, and grey wastebasket. The user-supplied
dock reference informed visual restraint and varied icon identities; no
reference logos or existing app artwork were reproduced.

## App Library

The left sidebar contains Discovery and Updates and can accommodate future
sections. The Apps heading has no refresh icon. View → Refresh reloads the app
catalog and update history. Check for updates is a separate, quiet action at
the sidebar bottom.

Discovery uses compact cards with 36px original app artwork, a name, installation
status and short description. The grid uses a 220px minimum card width: two
columns at a typical 900px window, more when widened, and one on narrow screens.
Selecting a card opens a dedicated details page without launching the app.
Back and Forward navigate the local page history, including sidebar sections;
opening a new page after going back replaces the forward history.
Updates uses compact rows with a direct Update button for each app and an Update all
action in the list heading. Updates run sequentially, with progress beside each app;
a brief service-restart notice stays in the list. Installation and removal retain
their package review. Available package versions appear above a separate history
list showing the previous and new app version directly, with no disclosure control. Completed updates leave the available list
and appear in history; apps already up to date do not occupy available-update rows.
Empty and failed checks remain distinct.

The Image Gen concept from 2026-09-27 informed the two-section hierarchy, neutral
palette, quiet sidebar and compact update rows. User refinement superseded its
full-width Discovery rows with adaptive cards. Existing original icons, actual
package data and the requested installed-update history replace the concept's
illustrative icons, figures and recent-activity labels.

## Desktop pet

When Pi is installed, Pi Settings → Pet offers Cat, Fox and Robot, using original articulated SVG characters in
`src/shell/PetSprite.tsx`. The pet sits above desktop windows and stays below menus. Its
transparent surroundings allow clicks through; only its handle and speech bubble
receive input. During file or other native drag operations the pet becomes
passive so underlying destinations can receive the drop. Lumo Use excludes these controls from observations and actions.

Drag or use arrow keys to move the pet. Shift moves farther; Home resets position.
Character, visibility, completion bubbles and relative position are remembered per
account in the current browser. Relative coordinates keep the pet reachable after
resizing, clear of the menu bar and dock. Right-click offers settings, reset and hide.

The pet breathes, looks around, blinks and sways its tail while idle. While any Pi
chat is working it studies a notepad and writes; completion brings a small hop,
a wave and sparkles. Separate SVG body parts move continuously in browser CSS;
there are no raster frames or sprite-sheet swaps. Completion bubbles use the same typed outcome
as system notifications: Work done, Stopped or Needs attention. They dismiss after
eight seconds or through their close control. Enabling Completion bubbles shows
a temporary Hello greeting beside the pet as a preview. Background and minimized chats update
the pet; one finishing chat does not cancel another chat's working state. Reduced
motion keeps the pose changes and disables repeating animation.

## Pi navigation rail

The chat sidebar toggle sits above Home in Pi's left navigation rail. Collapsing
removes the sidebar's width and border, leaving one rail beside the conversation.
New chat moves into that rail while collapsed; Settings stays at the bottom.
Settings keeps the sidebar toggle and New chat visible but disabled.
Hidden sidebar controls are excluded from keyboard and accessibility navigation.
