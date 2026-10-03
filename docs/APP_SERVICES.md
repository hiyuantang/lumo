# App services

Lumo owns an account-scoped notification inbox and app icon rendering. Apps use
these shared services through their manifests and host API.

## Complete plugins

Declare `notifications.send` in the manifest permissions. The frontend uses:

```ts
import { sendNotification } from '@lumo/sdk/api/notifications';
await sendNotification('my-app', {
  requestId: crypto.randomUUID(), title: 'Export ready', body: 'Your report is saved.'
});
```

The first argument is the package name, without `plugin:`. Keep the requestId
when retrying the same event. Each new event needs a new ID. The host uses the
installed manifest for app identity. Titles allow 120 characters, bodies 2000,
and request IDs 8–128. Plain text only. Ten new messages per app per minute are
allowed. Failures must stay visible to the caller; do not report success early.

Backend and Pi-triggered work can notify without an open app window. From the
backend use `node:child_process` to run `process.env.LUMO_HOST_EXECUTABLE` with
`['app-notify']`, pass the same JSON message on stdin, and check its exit status.
Inherit HOME, LUMO_APP_NAME and LUMO_HOST_EXECUTABLE. Both HTTP backend requests
and `lumod plugin <name> ...` supply these values. Do not use a shell, detach a
process, or write the inbox files yourself. Put notification side effects in Pi
writeTools and reject them in read-only mode. Share the backend operation between
UI and Pi tools.

The account inbox persists read/dismissed state. A connected desktop checks every
10 seconds and on focus; frontend sends refresh it immediately. Messages wait
when the desktop is offline. This is Lumo's notification center, not operating
system push. The service does not schedule or keep app jobs alive. A request
backend still finishes within its normal lifetime; an already running job or an
explicitly configured account service may send through `lumod app-notify` with
its package identity. Uninstalled packages cannot send new messages. Lumo retains
the newest 500 records, including dismissal/deduplication receipts; retry IDs are
remembered only while their records are retained. Existing messages remain after
uninstall and may be dismissed by the account.

Set `icon` to a Lumo glyph, for example `IconCalendar`, `IconBell`, `IconFolder`,
`IconCode`, `IconGlobe`, or `IconGrid` (fallback). For original artwork, put a PNG
at `assets/icon.png` and set `iconImage` to that path. Use 16–256 pixels on each
side, at most 32 KiB. Build embeds it into the immutable manifest; no remote URL,
SVG or extra asset server is needed. An already embedded `data:image/png;base64,`
value also works. Invalid images fail validate, build and package import. An
embedded icon takes precedence over the glyph and appears in app surfaces and
notifications. Keep original artwork self-contained and respect its license.

Verify a notification with the window closed, refresh the desktop, dismiss it,
and refresh again. Test a duplicate requestId, a missing permission and invalid
icon bytes. A native package is trusted account code; these manifest checks are
an integration contract, not isolation from other account code.

## Sandboxed apps

Use the capability `notifications.send` and the same message shape through
`lumo.call('notifications.send', message)`. The host binds the sender to the
current launch token, session, installed digest and revision. Undeclared,
revoked or cross-session calls fail. Preview validates but does not deliver.
Closing the frame stops its code; saved notifications survive. The sandbox
builder accepts the same `icon` and `iconImage` fields. Full authoring guidance
is in `server/internal/desktopapps/APP_BUILD.md`.

## Engine API

Authenticated requests route to the current account agent:

- `GET /api/v1/notifications`: undismissed messages in creation order.
- `POST /api/v1/notifications/action`: `{action:"read"|"dismiss",ids:[...]}`;
  idempotent, applies only to those IDs, including with multiple open desktops.
- `POST /api/v1/notifications/send`: native `{app,requestId,title,body}`;
  requires an installed package declaring `notifications.send`.
- `lumod app-notify`: same message on stdin; package comes from LUMO_APP_NAME.

Inbox storage uses a private account directory, a cross-process file lock, and
atomic replacement. No broker privilege or global notification database is used.
Notification text is rendered as text. All frontend access uses the data source
seam; components must not call fetch directly.
