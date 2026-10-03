# App connections to the Lumo engine

Lumo provides a shared desktop and typed services. Each app owns its interface,
data rules, backend operations and Pi tools. Its manifest connects those parts
to the engine. Required system apps use the same packaging model, with removal
restricted where the desktop depends on them.

| Connection | Native plugin | Sandboxed app | Engine responsibility |
| --- | --- | --- | --- |
| Top bar | `useAppMenus` | `lumo.setMenus` / `onCommand` | Focus, keyboard navigation, checked/disabled states |
| Command Center | Enabled menu actions and `commands` | Same bridge descriptors | Search, deduplicate per window, focus before running |
| Dock | `dock` menu, window badge | Same bridge descriptors | Open/restore/new/close, window choice, badge rendering |
| Windows | `useAppWindow`, `window.multiple` | Title/status bridge; sandbox windows support New Window | Layout, focus, restore, title and app identity |
| Draft protection | Close guards and shared confirmations | `lumo.setDirty` plus save tracking | Guard close, app removal, reload and window actions |
| Local view state | `useAppState`, `useAppPreference` | Frame state; declared app storage | Account/window browser keys; server storage revisions |
| File selection and local menus | Shared FilePicker, modal, confirmation, context menu | App-local UI within its sandbox | Reusable interactions and accessibility |
| Notifications | SDK or backend `app-notify` | Declared notification capability | Identity, permissions, inbox, delivery and deduplication |
| Icons | Manifest glyph or packaged PNG | Manifest glyph or packaged PNG | Consistent library, dock, window and inbox rendering |
| Backend | Namespaced request routes and CLI operations | Declared capability calls | Authentication, routing and bounded request lifetime |
| Pi tools | Packaged extension sharing backend operations | Built through core app-building tools | Tool loading and permission modes |
| Background UI work | Manifest `background` entry | No background frame when window is closed | Mount per desktop session; cleanup on update/uninstall/logout |
| Package lifecycle | Manifest, immutable assets, account catalog | Manifest, immutable assets, account catalog | Validation, install, update, rollback and removal |

The native builder exposes these desktop primitives through `@lumo/sdk/app`.
See the [native guide](../server/internal/appbuilder/GUIDE.md) and
[sandbox guide](../server/internal/desktopapps/APP_BUILD.md) for authoring and
validation rules. [APP_SERVICES.md](APP_SERVICES.md) covers notification delivery
and icons. Adding an app does not require adding a menu, dock or window branch
inside the engine.

Contributions live with their mounted window. Search includes open and minimized
windows; closed windows have no registered commands. Dock contributions and
badges come from that app's most recently focused window. There is no background
command registration API. A background React component is mounted per desktop,
not per account server: it stops when the desktop closes and may run in several
browser tabs. Durable jobs need an explicit account service. Notifications do
not provide scheduling or keep a request backend alive.

Native plugins run as trusted account code. SDK imports and manifest declarations
are integration contracts, not a security sandbox. Sandboxed apps remain behind
validated messages and capability checks. Typed privileged operations remain in
the host broker with authorization and audit; plugins cannot add arbitrary root
commands through a manifest.

## Compatibility boundaries

Some older core workflows still have named adapters: Files opens documents in
Preview, Settings has section navigation, Pi has assistant-window presentation,
and Command Center includes host service and network shortcuts. Authentication
providers and resident backend modes are restricted system integrations. This
change does not introduce general file associations, arbitrary shell widgets,
custom global keyboard shortcuts or persistent job scheduling.

Use the generic connections above for new app features. When migrating a named
adapter, define a reusable typed contract and preserve its existing user flow,
permissions and unsaved-work protection. Avoid claiming that all legacy shell
coupling has been removed.

## Verification

The offline checks cover native SDK compilation/install, optional background
entry validation, message limits and malformed payloads, menu command dispatch,
window focus/isolation/restoration, dock status, search deduplication and cleanup.
Docker checks load real built packages and verify that background components
survive window close and stop on uninstall. Browser checks include light/dark
and wide/narrow layouts. Run `npm run build`, `npm run test:unit`, the relevant
`npm run test:ui -- tests/ui/app-connections.spec.ts tests/ui/desktop-apps.spec.ts`
and `npm run test:docker`.
