# Lumo backend plugin SDK

This Go module is the shared, versioned interface for app backend executables.
It has no dependency on the desktop host or on another app. Licensed
AGPL-3.0-only, as specified by the repository's LICENSE.

A backend registers its HTTP handlers, then calls `plugin.Serve(handler)`.
The host sends one HTTP request through standard input. The backend writes one
JSON `Reply` through standard output and exits. Standard output is reserved for
this protocol; diagnostics go to standard error. The host supplies the account's
home directory and retains authentication and mutation replay handling.

`Reply` contains an HTTP status, selected response headers, and a base64-encoded
body. A typed `BrokerAction` can replace the HTTP response. The host checks the
app's allowed action, matches the original request ID, supplies the session,
and forwards the action to the broker. The backend never receives a session
token. Broker authorization and validation remain mandatory.

Protocol version 1 accepts bodies up to 1 MiB and encoded replies up to 32 MiB.
The host ends a request after 75 seconds and terminates its process group on
cancellation. The native process has the authenticated user's ordinary file and
process access; the SDK is not an isolation sandbox.

See [App plugins](../docs/SHIPPED_APP_PLUGINS.md) for packaging, deployment,
compatibility boundaries, complete-package rollback and verification.

Account plugins receive `LUMO_APP_DATA`, an app-specific private directory path.
Create it when needed and keep app-owned settings, caches and data beneath it.
Normal package removal preserves it; clean removal moves it to recoverable Trash.
Backend routes for new apps use `/api/v1/plugins/<package-name>`.
