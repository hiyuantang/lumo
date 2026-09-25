# Lumio OS — Desktop Style

## Direction

The desktop uses macOS 27's public visual direction as a reference for
clear glass, consistent toolbars, rounded window geometry and full-height
sidebars. Reference: [Apple's macOS 27 overview](https://www.apple.com/os/macos/).
No third-party implementation source or Apple assets are used.

Lumio retains Inter, original line icons, teal and amber accents, and
rounded-square window controls. The shell, apps and transitions are
rendered locally. The wallpaper is a single bundled WebP asset; it does
not animate or generate recurring network traffic.

## Shared visual system

- Light content: near-white surfaces, dark blue-gray text and restrained
  separators. Translucency belongs to chrome, sidebars, menus and the dock.
- Dark content: charcoal-teal surfaces with light text and the same geometry.
- Window corners: 18px; menus and sheets: 16px; controls: 8–10px.
- Window titlebars: 50px; standard controls: 30px; file rows: 38px.
- Files uses a full-height navigation sidebar and an opaque document area.
- Eight original dock glyphs sit on teal, amber, graphite, ivory and silver
  tiles. Running and minimized states retain explicit indicators.
- Compact windows hide the Files sidebar and retain breadcrumb navigation.
  Narrow screens use the existing single-window behavior with room for the dock.
- All current actions and test hooks remain available. No new application
  runtime, streamed desktop or Markdown renderer is added by this restyle.

## Window behavior

- Controls run left to right: close, minimize, maximize/restore.
- Minimize shrinks the window into its own Dock icon; selecting that icon
  reverses the motion and restores the existing window, including its
  size, placement and app state. A window badge and Restore tooltip identify
  minimized apps. Clicking an already active Dock icon keeps its window open.
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
- The View menu provides the same tiling, maximize and restore actions.
  Half-width tiling is available only when the app's minimum size fits.
- Windows use the area below the menu bar and end at the top of the dock
  without an extra wallpaper gap. Maximizing, snapping, moving, resizing
  and restoring a saved layout all use this same area.
- Compact screens keep one active window above the dock; desktop tiling
  and resizing controls are unavailable at these widths.

## Reference-to-implementation choices

The generated concept is 1586 × 992. The implementation follows its
teal-and-sand palette, clear chrome, full-height Files sidebar, striped
list, rounded geometry and eight-icon floating dock. It keeps compact
12.5–14px desktop type, original Lumio SVG glyphs and user-controlled
window sizes. Dates, system activity and file content come from the
selected data source rather than the illustrative values in the concept.
The dock uses live glass and shadows without a painted reflection.

## Generated asset provenance

Generated with the built-in Image Gen tool. The concept is a design
reference; all live controls, text and icons are implemented as React,
CSS and original SVG. The wallpaper is bundled at
`src/assets/lumio-tidal.webp`, encoded from the generated wallpaper without
changing its composition.

Concept prompt:

```text
Use case: ui-mockup. Create one high-fidelity 1440x900 desktop screenshot concept for Lumio OS, an existing React web desktop that controls an Ubuntu VPS. The user asks for the visual feel of macOS 27: refined clear glass, rounded windows, consistent toolbars, full-height translucent sidebars, soft precise depth and a floating glass dock. This must remain original Lumio branding; NO Apple logos, Apple icons, Apple wallpaper, San Francisco font, or macOS traffic-light circles. Use Inter-like typography and existing warm teal accent plus amber, graphite text on nearly white content. Original abstract wallpaper of broad softly curved folded shapes in deep sea teal and warm sand/gold, light upper area, quiet visual detail, elegant desktop feel. All UI will be real HTML/CSS and original vector icons, not a screenshot used as UI. Exact frame: edge-to-edge desktop, 32px glass menu bar at top. Left text 'Lumio OS', 'atlas.lan', 'File', 'View', 'Files'. Right subtle CPU '8%', network '1.5 MB/s', clock 'Fri, Sep 25 11:45 AM', bell glyph, user 'demo'. A single Files window at x96 y72, size860x580. 48px high gently translucent titlebar, three small rounded-square glyph buttons for minimize, maximize, close in muted amber, teal and coral (NOT circles), folder glyph and centered title 'Files'. The app below has a 165px-wide subtly frosted sidebar with section 'Locations', selected 'Home', section 'Folders', actual folders 'backups', 'Documents', 'Pictures', 'projects', all original line folder icons. Sidebar spans content height. Main area opaque near-white. Top toolbar has 'Home' breadcrumb then real buttons 'Upload', 'Quick Look', 'Edit protected file'. Below is a carefully aligned compact table with columns 'Name', 'Size', 'Modified'. Rows in exact order: 'backups', 'Documents', 'Pictures', 'projects', '.bashrc', 'notes.txt'. Folders sizes em dash; .bashrc size '3.7 KB', notes.txt '218 B'. Modified dates compact muted text. 38px table rows with subtle alternating neutral fills, teal folder glyphs, generous remaining empty white area. Bottom slim status strip '6 items' and 'Home'. No fake search or invented features. Bottom centered dock near y806 contains exactly eight colorful rounded-square original app glyphs: Home, Services, Files, Terminal, Logs, Updates, Network, Settings. No permanent text labels under dock, a tiny running dot under Files. Dock is frosted glass with a luminous top hairline and restrained reflection; colorful icons are teal house, golden service gear, teal folder, graphite terminal, cream log list, amber update chip, teal network arrows, silver settings gear. Beautiful balanced practical CSS styling; distinguish toolbars from document surfaces. No extra widgets, giant title, cards, marketing labels, logos, gradients over text, or unrelated applications. Crisp legible interface at native screen scale.
```

Wallpaper prompt (using the generated concept as the reference image):

```text
Use case: background-extraction. Use the attached Lumio OS desktop concept as a visual reference and create its standalone ORIGINAL wallpaper. Remove ALL user interface: window, sidebar, menus, dock, icons, text, numbers, borders and shadows of UI. Reconstruct the entire background continuously behind the removed interfaces. Preserve the concept's original broad flowing folds: deep sea-teal curved forms sweeping down the left and across the bottom, a luminous muted sandy-gold folded area at the right and upper-right, a pale misty teal-to-ivory top region. Sculptural fine matte satin, restrained light on the folded edges, very smooth broad contours, subtle texture, calm refined desktop wallpaper, not busy. No Apple wallpaper imitation; retain this particular original composition from the Lumio concept. Output wallpaper only, landscape 16:10, around 1920x1200, absolutely no text, no logos, no interface, no border.
```
