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
- Search boxes, text fields and editors have no outer focus ring or focus
  shadow. Fields with borders indicate focus by subtly strengthening the
  existing border. Other controls retain visible keyboard focus indicators.
- Scrollbars sit at the edge of their panel or dialog, with content padding
  inside the scroll area. Scrollable forms and compact lists reserve a stable
  scrollbar gutter and
  at least 8px of clearance beside it, including a track allowance for overlay
  scrollbars. Fields, trailing checkboxes and
  rounded row highlights must stay clear of the track. Preserve larger insets
  and the alignment of table and calendar columns.
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

## Notifications

- Notification history is a stack of separate matte cards over the desktop,
  without a surrounding panel or visible heading. Each card reveals its circular
  close control on hover or keyboard focus. Clicking outside closes history and
  performs the clicked action.
- New cards slide in from the right, remain for six seconds, then slide back out.
  Hover or keyboard focus pauses dismissal. Reduced motion skips the slide.
  Automatically dismissed banners remain in history; closing a card removes it.
- Pi completion, failure and attention notifications appear when the conversation
  is in the background, minimized or closed. A visible floating Pi assistant
  suppresses these notifications even while another app is focused. Hidden
  conversations still notify. Retry progress stays inside Pi.

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
- Drag to the left or right edge to preview half-width tiling. Maximization
  requires pulling the pointer 24px above the work area's top edge, into the
  top 8px of the menu bar. Reaching the top of the work area keeps the window
  floating. Release to apply the preview, or press Escape
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

When Pi is installed, Pi Settings → Pet offers Triangle, Pebble, Square and Diamond
with seven independent coat colors: vivid yellow, lime, pink, cyan, orange and
purple, plus a warm cream. These use original geometric characters in
`src/shell/PetSprite.tsx`. The pet sits above desktop windows and stays below menus. Its
transparent surroundings allow clicks through; only its handle and speech bubble
receive input. During file or other native drag operations the pet becomes
passive so underlying destinations can receive the drop. Lumo Use excludes these controls from observations and actions.

Drag or use arrow keys to move the pet. Shift moves farther; Home resets position.
Shape, coat, gravity, visibility, completion bubbles, individual activity choices and relative position are remembered per
account in the current browser. Relative coordinates keep the pet reachable after
resizing and clear of the menu bar. Right-click offers settings, Take notes,
Play soccer, Juggle stars, Read a book, Play golf, Play basketball, Paint, Play drums,
Blow bubbles, reset and hide. Each trick conjures its props with a
wand and sparkles, performs for a few seconds, then makes the props disappear.
Pet settings includes a trailing switch for each activity in compact rows, with two
columns when the content has enough room and one in narrow windows. Disabled activities leave
the context menu and idle selection, and disabling the current one clears its props.
Golf balls travel across the desktop, rebound off either edge with decreasing speed,
and bounce on their play surface; basketballs dribble. Sports props stay below the
menu bar and inside the viewport, clear on pickup or resize, and ignore pointer input.
Reduced motion shows still props without moving the ball.

Free mode allows these stationary tricks; Gravity also chooses them between
walks and rests, avoiding consecutive tricks and repeated activities.

The pet breathes, looks around, blinks and gently dangles its sketch-like limbs
while idle. While any Pi chat is working it studies a notepad and writes; completion brings a small hop,
a wave and sparkles. SVG limbs and the canvas body move together in browser CSS.
Fine fur strands follow the silhouette; hovering ruffles them and a short spring
animation settles them, then stops requesting frames. Settings previews stay
still. There are no raster frames or sprite-sheet swaps. Completion bubbles use
the same typed outcome as system notifications: Work done, Stopped or Needs attention. They dismiss after
eight seconds or through their close control. Enabling Completion bubbles shows
a temporary Hello greeting beside the pet as a preview. Background and minimized chats update
the pet; one finishing chat does not cancel another chat's working state. Reduced
motion keeps the pose changes and disables repeating animation and fur interaction.

Gravity is off by default: the pet stays where placed. With Gravity on, a local
motion controller reads the live dock bounds and treats the dock top and the
exposed desktop floor as supports. It chooses walking or running speeds,
directions and rest intervals randomly. Short docks permit crouching, jumping
off either exposed edge, and two ways to return. Edge climbing keeps the body
beside the dock, alternates grips, then pulls over the lip. The magic route
grows a striped pole from the floor, climbs vertically, hops onto the dock and
dismisses the pole. The pole remains planted throughout the climb and hop.
A dock filling the available width has no edge exits. Stride follows distance
traveled, with acceleration, braking and a projected ground shadow.

Pickup suspends roaming and tilts the pet with pointer velocity. Recent pointer
samples determine the throw speed and direction; holding still before release
lets that momentum decay. Gravity follows a ballistic arc, with soft desktop
and dock-edge collisions. Landings squash the body and show dust, rebound with
less energy each time, then skid to a stop with ground friction. Fast throws
show short sketch trails, air stretch and a gentle tumble. Physics uses small
time steps so collisions remain stable across frame rates.
Free mode shows the pickup and landing poses without changing the released
position. Bubbles fit their text and close control, stay inside the viewport and
pause roaming. Hover, keyboard focus, the pet menu, native drag operations and Pi
work also pause roaming. Rest uses a timer; active movement updates local DOM
styles per frame without React renders. Hidden pages stop scheduling movement.
Reduced motion settles on a support immediately and disables roaming and effects.
Requested tricks show a still prop pose for their duration. Pickup, a new Pi
task, and completion bubbles clear activity props; terrain changes cancel a
climb and return the pet to a valid support.

## Pi navigation rail

The chat sidebar toggle sits above Home in Pi's left navigation rail. Collapsing
removes the sidebar's width and border, leaving one rail beside the conversation.
New chat moves into that rail while collapsed; Settings stays at the bottom.
Settings keeps the sidebar toggle and New chat visible but disabled.
Hidden sidebar controls are excluded from keyboard and accessibility navigation.

## Calendar and Reminders

Calendar is a built-in app. Its compact vertical rail switches between calendar
views, local reminders and account connection. The adjacent sidebar holds
calendar visibility or reminder filters and lists; it becomes dismissible at
narrow widths. Calendar uses a month grid, a scrolling day/week timeline with a
persistent all-day strip, and an adaptive year grid. Overlapping timed events
share columns. Today uses a red date marker with white text in both themes; calendar colors identify events.
Month uses continuous native vertical scrolling through unique week rows, with
a fixed weekday header. Boxes fit whole rows to the window, and scrolling
settles to the nearest week row after input and momentum end. New input
immediately interrupts settling. The month with the largest visible cell area
determines the title and date highlighting; ties retain the current month.
Only nearby rows render, and the scroll range extends
in both directions while preserving pixel position. Explicit date navigation
positions the requested month's first week. Day, week and year pages move horizontally.
Trackpad input directly moves the current and adjacent calendar
pages with the fingers, including reversal. Navigation commits after gesture
input and momentum end; distance and velocity decide whether to settle on the
adjacent period or return to the starting page. Reduced motion retains direct
tracking and omits settling animation. Vertical scrolling within timelines
and year grids, and sideways scrolling within a narrow
timeline retain their native behavior;
an outward swipe begun at a timeline edge navigates dates. Gestures are scoped
to the calendar content, leaving the rail, sidebar, details and sheets alone.
Neighboring pages reuse known events while loading their date range through the
existing data source. A prepared snapshot can serve the committed
page without a second read, and previews remain outside keyboard navigation.

Event details show the item's own title, collection and Edit action, followed by
one divider and metadata. Editing uses the shared app sheet and protects unsaved
changes. Selection, visibility and completion controls sit on the right and only
the input itself toggles them. Search filters the current event range or reminder
list. The shared menu exposes New Event, New Reminder and the four views.

The user's Calendar/Reminders reference screenshots establish the view anatomy
and grouping, while Pi's rail, shared search, fields, checkboxes, sheets and matte
tokens establish Lumo's implementation. No Apple assets, sample events, typography
or source code are used. The app identity is an original blue calendar/check SVG.
