# Lumo — Wire Protocol

This document is the contract between the browser client and the web
gateway. The Go server and the TypeScript client are both implemented
from it, and only from it. Related documents:
[PRIVILEGE_MODEL.md](PRIVILEGE_MODEL.md),
[ERROR_AND_RECOVERY.md](ERROR_AND_RECOVERY.md),
[THREAT_MODEL.md](THREAT_MODEL.md).

## Transport

1. All traffic uses HTTPS. During Phase 2 the gateway binds to
   localhost only and is reached through an SSH tunnel.
2. REST carries request/response operations. WebSocket carries event
   subscriptions and bidirectional streams.
3. Bodies are UTF-8 JSON unless stated otherwise. Binary payloads
   (PTY data, file content) are base64-encoded inside JSON so that a
   single decoder handles the whole socket.
4. Size limits: 1 MiB per REST body, 64 KiB per WebSocket frame.
   Larger transfers use paged capabilities (`journal.query`,
   `files.read` with ranges). Endpoint-specific override:
   `PUT /api/v1/files/write` accepts bodies up to 12 MiB, which holds
   8 MiB of decoded file content after base64 inflation;
   `POST /api/v1/files/write-privileged` accepts 2 MiB for its 1 MiB
   decoded-content limit.
5. The server never pushes application code over this protocol; the
   browser renders everything from its shipped bundle.
6. Request bodies and WebSocket frames contain exactly one JSON value.
   Unknown request fields and trailing values are rejected at every hop;
   response clients continue to ignore unknown additive fields.

## URL layout and versioning

```text
GET  /api/v1/meta/version
POST /api/v1/auth/login                  Phase 4
POST /api/v1/auth/logout                 Phase 4
GET  /api/v1/auth/session                Phase 4
POST /api/v1/auth/reauth                 Phase 4
GET  /api/v1/system/identity
GET  /api/v1/system/overview
GET  /api/v1/system/metrics              one sample; live stream over WS
POST /api/v1/system/power                Phase 6
GET  /api/v1/system/settings             Phase 6
GET  /api/v1/system/timezones            Phase 6
POST /api/v1/system/settings             Phase 6
GET  /api/v1/network                     Phase 6
POST /api/v1/network/apply               Phase 6
POST /api/v1/network/confirm             Phase 6
GET  /api/v1/services
GET  /api/v1/services/detail             Phase 5
POST /api/v1/services/action             Phase 4
GET  /api/v1/journal
GET  /api/v1/files/locations
GET  /api/v1/files/list
GET  /api/v1/files/read
PUT  /api/v1/files/write                 Phase 3
POST /api/v1/files/create                Create file or folder
POST /api/v1/files/move                  Move file or folder
POST /api/v1/files/delete                Phase 3
POST /api/v1/files/write-privileged      Phase 5
GET  /api/v1/updates/packages            Phase 5
POST /api/v1/updates/refresh             Phase 5
POST /api/v1/updates/plan                Phase 5
POST /api/v1/updates/apply               Phase 5
GET  /api/v1/calendar                    Date-range snapshot
POST /api/v1/calendar                    Typed item/list changes
POST /api/v1/calendar/notices            Claim due local alerts
GET  /api/v1/calendar/google             Connection status, no secrets
POST /api/v1/calendar/google             Configure, authorize or disconnect
GET  /api/v1/calendar/google/callback    One-use OAuth return
GET  /api/v1/apps
POST /api/v1/apps/plan
POST /api/v1/apps/pi/uninstall
POST /api/v1/apps/pi/plan
POST /api/v1/apps/pi/apply
GET  /api/v1/apps/pi/progress
GET  /api/v1/containers
GET  /api/v1/containers/detail
GET  /api/v1/containers/logs
POST /api/v1/containers/action
GET  /api/v1/websites
GET  /api/v1/websites/logs
POST /api/v1/websites/save
GET  /api/v1/ws                          WebSocket upgrade
```

1. The version lives in the URL path (`/api/v1`). Within a version,
   changes are additive only: new fields, new capabilities, new error
   `details` keys. Clients must ignore unknown fields.
2. A breaking change ships as `/api/v2`; v1 keeps working until the
   next major release of the product.
3. `GET /api/v1/meta/version` returns the server build and the list of
   supported protocol versions so a client can feature-detect rather
   than version-sniff.

## Envelopes

### Success

```json
{
  "ok": true,
  "data": { }
}
```

`data` is the capability-specific result object. REST responses do not
wrap the request back into the envelope; the URL identifies the call.

### Error

```json
{
  "ok": false,
  "error": {
    "code": "stale_revision",
    "message": "The file changed on disk since it was read.",
    "details": {
      "expectedRevision": "sha256:9f2c…",
      "actualRevision": "sha256:41b0…"
    }
  }
}
```

1. `code` is machine-readable and closed (see Error codes).
2. `message` is human-readable English, suitable for logs; the UI may
   show it but must not parse it.
3. `details` is a capability-specific object and may be empty.
4. The same shape is used for REST error bodies and for WebSocket
   error frames.

## Authentication and authorisation

Authentication itself lands in Phase 4, but Phase 2 clients are shaped
against these rules so no client change is needed later.

1. Login establishes a session cookie: `lumo_session`, `HttpOnly`,
   `Secure`, `SameSite=Strict`, `Path=/`. Session identifiers are
   generated by the server at login and never accepted from the
   client.
2. Login also issues a CSRF token in a second, readable cookie
   `lumo_csrf` (not `HttpOnly`). Every non-GET REST call must echo it
   in the header `X-Lumo-CSRF`. The WebSocket upgrade request must
   carry the same header; because browser WebSocket clients cannot set
   headers, the upgrade may instead carry the token in the `csrf`
   query parameter (`/api/v1/ws?csrf=…`), which is an equivalent
   credential.
3. The gateway checks the `Origin` header on the WebSocket upgrade and
   rejects cross-origin connections.
4. `401 unauthorized` — no session, expired session, or bad session
   cookie. The client returns to the login screen.
5. `403 forbidden` — a valid session, but the CSRF check failed, or
   the action was denied by the authorisation layer
   ([PRIVILEGE_MODEL.md](PRIVILEGE_MODEL.md)). The client must not
   retry a `403` without user involvement.
6. Authorisation is per action and re-checked on every call; a session
   is never a blanket capability grant.

## Idempotency and preconditions

1. Every mutation carries a client-generated `requestId` (UUID v4).
2. The server deduplicates by `requestId` for 24 hours. A duplicate
   returns the stored result of the first execution with the header
   `X-Lumo-Idempotent-Replay: true` and performs no second mutation.
3. Mutations may carry an `expected` object: preconditions compared
   against live system state immediately before execution. A mismatch
   fails the call with `conflict` or `stale_revision` and executes
   nothing.

Shape, following the Phase 4 privileged-action example:

```json
{
  "requestId": "6c4e8d2a-…",
  "action": "services.restart",
  "arguments": {
    "unit": "nginx.service"
  },
  "expected": {
    "activeState": "active"
  }
}
```

## Error codes

The initial list is closed. New codes require a protocol revision.

| Code | HTTP | WS close | Meaning | Client behaviour |
|---|---|---|---|---|
| `unauthorized` | 401 | 4401 | No or expired session | Re-authenticate |
| `forbidden` | 403 | 4403 | CSRF failure or authorisation denial | Fail fast |
| `not_found` | 404 | 4404 | Object does not exist | Fail fast |
| `conflict` | 409 | 4409 | Expected-state precondition failed | Refresh state, ask user |
| `stale_revision` | 409 | 4412 | Revision precondition failed | Re-read, then retry |
| `validation_failed` | 400 | 4400 | Schema or argument validation failed | Fail fast; client bug |
| `busy` | 409 | 4429 | Resource locked; `details.retryAfterMs` set | Retry after delay |
| `unavailable` | 503 | 4503 | Worker or broker down; `Retry-After` header | Retry with backoff |
| `internal` | 500 | 4500 | Unhandled server error | Retry once, then fail |

On WebSocket, channel-level failures are reported as an error frame on
that channel and do not close the socket. The close codes above apply
only when the socket itself is terminated (auth failure at upgrade,
protocol violation, shutdown).

## WebSocket channel model

One socket per session at `/api/v1/ws`, multiplexing numbered
channels. All frames are JSON text frames.

### Session frames

On connect the server sends:

```json
{ "type": "hello", "protocol": 1, "serverVersion": "0.4.2" }
```

The server sends `{ "type": "ping", "ts": 1721400000000 }` every 30 s;
the client answers `{ "type": "pong" }`. Two missed pongs close the
socket.

### Subscribing

Client:

```json
{
  "type": "subscribe",
  "channel": 3,
  "capability": "journal.stream",
  "params": { "unit": "nginx.service", "after": "s=abc…;i=41f;b=…" }
}
```

Server, either:

```json
{ "type": "subscribed", "channel": 3 }
```

or:

```json
{
  "type": "error",
  "channel": 3,
  "error": { "code": "validation_failed", "message": "…", "details": {} }
}
```

1. Channel ids are positive integers chosen by the client, unique per
   live socket. A closed id may be reused.
2. One capability per channel; `params` are the capability's
   subscription arguments.
3. `subscribed` may carry an optional `data` object. It is defined per
   capability; `terminal.open` uses it to return the session token
   (see Terminal). Clients must ignore it elsewhere.

### Data frames

Server to client:

```json
{ "type": "event", "channel": 3, "seq": 12, "data": { } }
```

Client to server (only for bidirectional channels such as terminals):

```json
{ "type": "input", "channel": 4, "data": { } }
```

`seq` is a per-channel, monotonically increasing integer starting at
1. A client that resumes a subscription can detect gaps by `seq`.

### Closing

```json
{ "type": "unsubscribe", "channel": 3 }
```

Server to client:

```json
{ "type": "closed", "channel": 3, "error": null }
```

`error` is non-null when the channel ended abnormally. Socket teardown
implicitly closes all channels; recovery rules per stream type are in
[ERROR_AND_RECOVERY.md](ERROR_AND_RECOVERY.md).

### Channel kinds

| Kind | Direction | Resume semantics |
|---|---|---|
| `system.metrics` | server → client | None; dropped on disconnect |
| `services.subscribe` | server → client | Fresh snapshot on resubscribe |
| `journal.stream` | server → client | Resume from `after` cursor |
| `terminal` | bidirectional | Reattach within grace period |
| `updates.progress` | server → client | Rebind by `requestId` |

#### Metrics ticks

Events carry one sample per tick. `params.intervalMs` selects the
interval (500–60000, default 2000). Samples that cannot be delivered
are dropped, never queued.

#### Journal stream

Every entry event carries an opaque `cursor` string (the journal's own
cursor). The client remembers the last cursor seen and passes it as
`after` when resubscribing. Delivery after reconnect is at-least-once:
entries at or near the cursor may repeat, and the client deduplicates
by cursor. `after: null` starts at the tail.

#### Terminal (PTY)

Opened by subscribing with capability `terminal.open` and params
`{ "cols": 80, "rows": 24, "shell": null }`. Optional `program: "pi"`
launches the installed Pi CLI directly, with no shell interpolation or
extra command arguments. `directory` accepts an absolute project directory
or `~` (the account's home). Other programs and a shell override combined
with Pi are rejected. Processes run as the authenticated Linux user.
The server checks `~/.local/share/lumo/pi/bin`, `~/.local/bin`, `/usr/local/bin` and
`/usr/bin` for Pi. Reattachment uses the existing session token and
does not restart the CLI. The server answers with a
`subscribed` frame that carries the session token in `data`:

```json
{ "type": "subscribed", "channel": 4, "data": { "session": "9b8c9799…" } }
```

Frames:

Client → server:

```json
{ "type": "input", "channel": 4, "data": { "kind": "stdin", "data": "<base64>" } }
{ "type": "input", "channel": 4, "data": { "kind": "resize", "cols": 132, "rows": 43 } }
```

Server → client:

```json
{ "type": "event", "channel": 4, "seq": 9, "data": { "kind": "stdout", "data": "<base64>" } }
{ "type": "event", "channel": 4, "seq": 10, "data": { "kind": "exit", "code": 0 } }
```

After an `exit` event the server closes the channel. If the socket
drops, the server keeps the PTY alive for 120 s; a `terminal.open`
subscribe with the same `session` token within that window reattaches
and replays the scrollback tail. After the grace period the PTY is
killed.

#### Update progress

Subscribe with capability `updates.progress` and params
`{ "requestId": "…" }` after `updates.apply` accepts a saved plan.
The broker keeps the latest snapshot, so reconnecting with the same
request id resumes progress without restarting the package operation.

```json
{
  "type": "event",
  "channel": 5,
  "seq": 3,
  "data": {
    "requestId": "0f7d…",
    "planId": "pln_01ab…",
    "phase": "installing",
    "percent": 72,
    "message": "Setting up openssl",
    "done": false,
    "success": false,
    "updatedAt": "2026-07-20T10:24:00Z"
  }
}
```

## Capability namespace

Capabilities are dotted names. Read-only capabilities are plain GET
endpoints; streams are WS channel kinds; mutations are POST/PUT with
`requestId`.

| Capability | Transport | Phase | Mutating |
|---|---|---|---|
| `system.identity` | GET | 2 | no |
| `system.overview` | GET | 2 | no |
| `system.metrics` | WS stream | 2 | no |
| `services.list` | GET | 2 | no |
| `services.detail` | GET | 5 | no |
| `services.subscribe` | WS stream | 2 | no |
| `services.action` | POST | 4 | yes |
| `journal.query` | GET | 2 | no |
| `journal.stream` | WS stream | 2 | no |
| `files.list` | GET | 2 | no |
| `files.read` | GET | 2 | no |
| `files.write` | PUT | 3 | yes |
| `files.delete` | POST | 3 | yes |
| `files.move` | POST | 3 | yes |
| `files.write-privileged` | POST | 5 | yes |
| `terminal.open` / io / resize / close | WS channel | 3 | yes |
| `updates.refresh` | POST | 5 | yes |
| `updates.plan` | POST | 5 | yes |
| `updates.apply` | POST + WS progress | 5 | yes |

Phase numbers refer to the build plan in BIG-PICTURE. A capability
called before its phase returns `unavailable`.

## Phase 2 subset — full examples

### `system.identity`

`GET /api/v1/system/identity`

`cpuModel` is the model name reported by `/proc/cpuinfo`; it is omitted when
unavailable. CPU counts in metrics represent logical CPUs visible to the server.

```json
{
  "ok": true,
  "data": {
    "hostname": "atlas",
    "os": {
      "id": "ubuntu",
      "versionId": "26.04",
      "prettyName": "Ubuntu 26.04 LTS",
      "kernel": "7.0.0-12-generic"
    },
    "architecture": "x86_64",
    "cpuModel": "AMD EPYC 7763 64-Core Processor",
    "bootId": "1e4c9a…",
    "serverTime": "2026-07-19T00:12:44Z",
    "user": {
      "name": "lumo",
      "uid": "1000",
      "gid": "1000",
      "home": "/home/lumo"
    }
  }
}
```

`user` (added in Phase 3) describes the account the agent runs as.
Clients use `user.home` as the Files home location; the Files path
model treats the first path segment as the home anchor.

### `system.overview`

`GET /api/v1/system/overview`

```json
{
  "ok": true,
  "data": {
    "uptimeSeconds": 938214,
    "cpuUsagePercent": 12.4,
    "memoryUsedBytes": 1610612736,
    "memoryTotalBytes": 4294967296,
    "updatesPending": 3,
    "securityUpdatesPending": 1,
    "failedUnits": 0,
    "rebootRequired": false
  }
}
```

### `system.metrics` (WS tick)

Subscribe with `{ "capability": "system.metrics", "params": { "intervalMs": 2000 } }`.
Each event:

```json
{
  "type": "event",
  "channel": 1,
  "seq": 8,
  "data": {
    "ts": 1721400164000,
    "cpu": { "usagePercent": 12.4, "load1": 0.42, "load5": 0.38, "load15": 0.31, "cores": 2, "perCore": [{ "id": 0, "usagePercent": 10.2 }, { "id": 1, "usagePercent": 14.6 }] },
    "memory": { "totalBytes": 4294967296, "usedBytes": 1610612736, "availableBytes": 2684354560 },
    "disks": [
      { "mount": "/", "totalBytes": 53687091200, "usedBytes": 12884901888 }
    ],
    "network": [
      { "interface": "eth0", "rxBytesPerSec": 15234, "txBytesPerSec": 8211 }
    ]
  }
}
```

`cpu.perCore` lists online logical CPUs by their Linux CPU ID, including sparse IDs.
The first sample for a newly observed core reports `usagePercent: null` until
an interval can be measured. Guest ticks are already included in user/nice
counters and are not counted again.

### `system.processes`

`GET /api/v1/system/processes` returns `{ "processes": [...] }`. Each entry
contains `pid`, `name`, `user`, `state` (Linux process state), `cpuPercent`, and
`memoryBytes` (resident memory). CPU usage is per logical core and may exceed
100% for multithreaded processes. It is null until two samples exist for the
same PID and process start time. Results contain only processes readable by
the authenticated account; processes that exit during sampling are skipped.
The fields follow the [Linux proc filesystem specification](https://docs.kernel.org/filesystems/proc.html).
This is a read-only endpoint and excludes command arguments and environment
variables. Monitor polls while Activity is open.

### `services.list`

`GET /api/v1/services`

```json
{
  "ok": true,
  "data": {
    "units": [
      {
        "name": "nginx.service",
        "description": "A high performance web server",
        "loadState": "loaded",
        "activeState": "active",
        "subState": "running",
        "enabledState": "enabled"
      },
      {
        "name": "backup.service",
        "description": "Nightly backup",
        "loadState": "loaded",
        "activeState": "inactive",
        "subState": "dead",
        "enabledState": "disabled"
      }
    ]
  }
}
```

### `services.detail`

`GET /api/v1/services/detail?name=nginx.service` returns the direct
`requires` and `wants` relationships reported by systemd together with
the fragment and drop-in files systemd loaded for that unit. Unit-file
content is capped at 1 MiB per file.

```json
{
  "ok": true,
  "data": {
    "name": "nginx.service",
    "documentation": ["man:nginx(8)"],
    "dependencies": [
      { "name": "network.target", "relation": "requires" }
    ],
    "files": [
      {
        "path": "/usr/lib/systemd/system/nginx.service",
        "content": "[Unit]\nDescription=A high performance web server\n",
        "override": false
      }
    ]
  }
}
```

### `services.subscribe` (WS)

After `subscribed`, the server sends one snapshot then change events:

```json
{ "type": "event", "channel": 2, "seq": 1, "data": { "kind": "snapshot", "units": [ ] } }
```

```json
{
  "type": "event",
  "channel": 2,
  "seq": 2,
  "data": {
    "kind": "changed",
    "unit": {
      "name": "backup.service",
      "activeState": "active",
      "subState": "running"
    }
  }
}
```

A `changed` event carries only the fields that changed, plus `name`.
This is how edits made over SSH surface in the browser without a page
refresh.

### `journal.query`

`GET /api/v1/journal?unit=nginx.service&priority=warning&boot=current&since=2026-07-19T00%3A00%3A00Z&limit=2`

```json
{
  "ok": true,
  "data": {
    "entries": [
      {
        "cursor": "s=abc…;i=41f;b=1e4c9a…;m=3f2a1;t=5f8c…;e=101",
        "ts": "2026-07-19T00:10:02.113Z",
        "priority": "warning",
        "unit": "nginx.service",
        "message": "upstream timed out",
        "fields": { "_PID": "812", "_COMM": "nginx" }
      }
    ],
    "nextCursor": "s=abc…;i=420;b=1e4c9a…;m=3f9bb;t=5f8d…;e=102"
  }
}
```

`cursor` values are opaque; clients store and return them verbatim.
`priority` accepts the usual syslog names; `since` accepts RFC 3339;
`boot` accepts `current` or `previous`. A host without a previous boot
returns an empty page.

### `journal.stream` (WS)

```json
{
  "type": "event",
  "channel": 3,
  "seq": 14,
  "data": {
    "cursor": "s=abc…;i=421;b=1e4c9a…;m=3fa01;t=5f8e…;e=103",
    "ts": "2026-07-19T00:12:47.902Z",
    "priority": "info",
    "unit": "cron.service",
    "message": "(root) CMD (run-parts /etc/cron.hourly)",
    "fields": { "_PID": "2401" }
  }
}
```

### `files.list`

`GET /api/v1/files/list?path=/etc/nginx`

```json
{
  "ok": true,
  "data": {
    "path": "/etc/nginx",
    "entries": [
      {
        "name": "nginx.conf",
        "type": "file",
        "sizeBytes": 1654,
        "mode": "0644",
        "modifiedAt": "2026-05-02T18:44:10Z",
        "symlinkTarget": null
      },
      {
        "name": "sites-enabled",
        "type": "directory",
        "sizeBytes": 4096,
        "mode": "0755",
        "modifiedAt": "2026-05-02T18:44:10Z",
        "symlinkTarget": null
      }
    ]
  }
}
```

Listing runs as the logged-in user; unreadable directories return
`forbidden` with `details.path`.

### `files.read`

`GET /api/v1/files/read?path=/etc/nginx/nginx.conf`

```json
{
  "ok": true,
  "data": {
    "path": "/etc/nginx/nginx.conf",
    "sizeBytes": 1654,
    "revision": "sha256:9f2c…",
    "encoding": "utf-8",
    "content": "dXNlciB3d3ctZGF0YTsK…",
    "truncated": false
  }
}
```

`revision` is a content hash taken at read time; it is the token later
used as `expected.revision` in `files.write`. Content is base64;
`encoding` records the detected text encoding, and binary files are
returned with `encoding: "binary"` and null content by default.

For read-only image viewing, `GET /api/v1/files/read?path=...&preview=image`
returns complete base64 bytes for PNG, JPEG, GIF, WebP, AVIF, BMP and ICO
files, including uppercase extensions. This mode accepts regular files only
and retains the authenticated user's filesystem permissions. The response
uses `encoding: "binary"` and an empty revision; it is not an editing token.
Images are limited to 32 MiB before base64 encoding. Larger files return
`truncated: true` with null content, never a partial image. Preview displays
these bytes in an image element with fit-to-window and actual-size views.
Fit uses the full available image area, scaling up or down without cropping
or changing the aspect ratio. The account's browser preference remembers Fit
or 100% across Preview windows and reopening. Double-clicking the image zooms
in; another double-click returns to the previous view without changing that
preference. Dragging an image larger than the viewing area pans it horizontally
and vertically; releasing or cancelling the pointer ends panning. Decoding
failures show an error. Ordinary text reads retain their
1 MiB limit.
HTML files use the text-reading contract and can switch between an isolated
rendered preview and raw editing. Inline styling and embedded data images are
supported. Scripts, forms, external navigation and external resources are
blocked; related local CSS and image files are not resolved in this view.

## Phase 3 subset — full examples

### `files.create`

`POST /api/v1/files/create` with `X-Lumo-CSRF`:

```json
{"path":"/home/alice/notes.md","kind":"file","requestId":"unique-request-id"}
```

`kind` is `file` (empty file) or `directory`. The absolute path must be
canonical and its parent must already exist. Creation runs as the authenticated
Linux user and respects filesystem permissions. It atomically refuses existing
files, folders, and symbolic links with `409 conflict`; it never overwrites them.
The same request ID replays the original response. Success returns the created
`path` and `kind`.

### `files.move`

`POST /api/v1/files/move` with `X-Lumo-CSRF`:

```json
{"from":"/home/alice/notes.md","to":"/home/alice/Documents/notes.md","requestId":"unique-request-id"}
```

Moves one file, symbolic link, or directory as the authenticated Linux user.
Both paths must be canonical and absolute, and the destination parent must
exist. An atomic no-replace rename refuses existing targets with `409 conflict`.
Moving a directory into itself, moving Trash storage, or crossing filesystems
returns `400 validation_failed`; nothing is copied or deleted on failure.
Success returns the destination `path`. A repeated request ID replays the
original response. Multi-selection sends one request per item and reports
failures individually; successful moves are retained.

### `files.write`

`PUT /api/v1/files/write`

```json
{
  "requestId": "f3b1…",
  "path": "/home/lumo/notes.txt",
  "content": "aGVsbG8K",
  "expectedRevision": "sha256:9f2c…"
}
```

Success:

```json
{
  "ok": true,
  "data": {
    "path": "/home/lumo/notes.txt",
    "revision": "sha256:41b0…",
    "sizeBytes": 6
  }
}
```

1. `expectedRevision` is optional. When present it must equal the
   current on-disk `revision` (see `files.read`); a mismatch fails with
   `stale_revision` and `details.expectedRevision` / `actualRevision`.
2. The write is atomic: temp file in the same directory, fsync,
   existing mode and ownership preserved, rename, directory fsync.
3. Decoded content is capped at 8 MiB per call (see Transport §4 for
   the matching body-size override).
4. `requestId` deduplicates per §Idempotency: a replay returns the
   stored result with `X-Lumo-Idempotent-Replay: true` and performs
   no second mutation.
5. Writes run as the process user. `EACCES` maps to `forbidden` with
   `details.path`; a missing parent directory maps to `not_found`.

### `files.delete`

`POST /api/v1/files/delete`

```json
{
  "requestId": "77aa…",
  "path": "/home/lumo/old.log"
}
```

Success:

```json
{
  "ok": true,
  "data": { "trashed": true }
}
```

1. The file is moved to the freedesktop trash layout under the user's
   home: `~/.local/share/Trash/files/` plus a `.trashinfo` record in
   `~/.local/share/Trash/info/` (original `Path` and `DeletionDate`).
2. Trash is only eligible when the home trash exists or can be created
   and the source is on the same filesystem; otherwise the call fails
   with `validation_failed` and a clear message.
3. Metadata is reserved and written before moving the source. Moving a symbolic
   link trashes the link itself, not its target. Duplicate names never overwrite
   an earlier item.
4. Trash is available through the per-user endpoints below. These use ordinary
   user permissions, gateway authentication and CSRF protection, with no root
   broker action.

### Trash management

The implementation follows the [freedesktop Trash specification](https://specifications.freedesktop.org/trash/latest/)
for the user's home Trash (`$XDG_DATA_HOME/Trash`, defaulting to
`~/.local/share/Trash`). The list also includes the signed-in account’s protected
app-cleanup bundles (see App removal). Other filesystem trash directories are
not aggregated.

- `GET /api/v1/trash` returns `{ "items": [...] }`. Each item contains `id`,
  `name`, `originalPath`, `deletedAt` (RFC3339), `type`, `sizeBytes`, `revision`
  and `canRestore`. Folder sizes are not recursively calculated. Missing or
  invalid recovery metadata leaves the item visible with `canRestore: false`.
- `POST /api/v1/trash/restore` accepts `{ "requestId": "unique-id", "item":
  { "id": "stored-name", "revision": "sha256:..." } }`. It returns the restored
  `path`. The original parent folder must exist. An atomic no-replace rename
  prevents overwriting an existing destination, including a symbolic link.
- `POST /api/v1/trash/delete` accepts `{ "requestId": "unique-id", "items":
  [{ "id": "stored-name", "revision": "sha256:..." }] }` and returns
  `{ "deleted": true }`. It permanently removes only the specified Trash
  entries and their metadata. Each storage group checks all of its revisions
  before deleting its items; a failure can leave a mixed batch partly completed. Filesystem errors may interrupt a batch; refresh the list afterwards.
  Each batch supports up to 10,000 items.

Restore and delete reject traversal IDs and stale item revisions. Permanent
removal is confined to the Trash storage root and does not follow symlinks.
The UI confirms destructive deletion and implements Empty Trash by sending the
reviewed list of items, so later arrivals are excluded. Both mutations use
request-id replay protection. Restoring an externally changed item requires
refreshing and reviewing the current entry.

## Phase 4 subset — authentication and privileged actions

### `auth.login`

`POST /api/v1/auth/login`

```json
{ "username": "alice", "password": "…" }
```

Success (200):

```json
{
  "ok": true,
  "data": {
    "user": { "name": "alice", "uid": 1000, "gid": 1000, "home": "/home/alice" },
    "csrf": "5f1c…"
  }
}
```

`Set-Cookie` carries `lumo_session` (`HttpOnly`, `Secure` when the
request is TLS, `SameSite=Strict`, `Path=/`) and `lumo_csrf`
(readable, same flags otherwise). Bad credentials answer
`401 unauthorized`. Login attempts are rate-limited per username and
source address with a small backoff; a limited attempt answers
`409 busy` with `details.retryAfterMs`.

### `auth.logout`

`POST /api/v1/auth/logout` — clears both cookies and drops the session
server-side; the per-user agent is terminated when it becomes idle.

### `auth.session`

`GET /api/v1/auth/session` — `200 { "data": { "user": { … } } }` for a
live session, `401` otherwise. Sessions slide-expire after 7 days idle
and absolutely after 30 days.

### `auth.reauth`

`POST /api/v1/auth/reauth` with `X-Lumo-CSRF`:

```json
{ "password": "…" }
```

`200 { "data": { "reauthenticatedUntil": 1721400900000 } }` marks the
session reauthenticated for five minutes (unix milliseconds); a wrong
password answers `401`.

### `services.action`

`POST /api/v1/services/action` with `X-Lumo-CSRF`:

```json
{
  "requestId": "6c4e8d2a-…",
  "action": "restart",
  "unit": "cron.service",
  "expected": { "activeState": "active" }
}
```

`action` is one of `start | stop | restart | reload | enable | disable`. Success:

```json
{
  "ok": true,
  "data": {
    "unit": {
      "name": "cron.service",
      "activeState": "active",
      "subState": "running",
      "enabledState": "enabled"
    }
  }
}
```

Failures:

- `401 unauthorized` — no session.
- `403 forbidden` — CSRF failure, or a polkit denial
  (`details.actionId`); when the policy demands reauthentication,
  `details.reauthRequired` is `true` and the client should run
  `auth.reauth` and retry within the five-minute window.
- `409 conflict` — `expected` precondition mismatch; nothing executed.
- `400 validation_failed` — unknown action, malformed or
  injection-shaped unit names.
- `503 unavailable` — broker or polkit down; nothing executed.

Every call reaches the broker over a peer-credentialed Unix socket and
produces audit begin/end rows (denials produce a deny row); see
[PRIVILEGE_MODEL.md](PRIVILEGE_MODEL.md) §Audit. Idempotent replay per
§Idempotency applies unchanged.

## Phase 5 subset — complete system applications

### Installed packages and available updates

`GET /api/v1/updates/packages` returns the authenticated user's read-only
view of the host's installed APT packages and locally cached upgrade plan:

```json
{
  "ok": true,
  "data": {
    "checkedAt": "2026-09-28T04:00:00Z",
    "rebootRequired": false,
    "packages": [{
      "name": "openssl", "version": "3.0.13-0ubuntu3.4",
      "architecture": "amd64", "summary": "Secure communication tools",
      "group": "system", "origin": "Ubuntu", "held": false,
      "updateVersion": "3.0.13-0ubuntu3.5",
      "updateGroup": "system", "updateOrigin": "Ubuntu", "security": true
    }]
  }
}
```

This endpoint runs local `dpkg-query`, `apt-cache policy` and an APT upgrade
simulation; it never refreshes repositories, downloads or installs packages.
`checkedAt` is the inventory read time, not the last repository refresh time.
Only installed records are included. Updates are those eligible for the
existing normal upgrade flow; held and kept-back packages are not offered.
If simulation fails, `updateError` explains the failure and installed packages
remain available without update fields.

`group` and `updateGroup` are `system`, `third-party` or `unknown`, based on
repository origin for the exact installed or target version. Ubuntu is system;
other origins, including PPAs, are third-party. Missing or conflicting origins
remain unknown. Security is a separate flag for security archives. It does not
classify a package as system software. Snap, Flatpak and manually installed
binaries are outside this APT inventory. The broker still prepares, validates
and applies the exact saved plan through the existing endpoints below.

### `updates.refresh`

`POST /api/v1/updates/refresh` with `X-Lumo-CSRF`:

```json
{ "requestId": "a120…" }
```

Success returns `{ "refreshedAt": "2026-07-20T10:20:00Z" }`.
Package operations are serialized by the broker worker.

### `updates.plan`

`POST /api/v1/updates/plan` with a `requestId` returns a plan that is
valid for 15 minutes on this host:

```json
{
  "ok": true,
  "data": {
    "plan": {
      "id": "pln_01ab…",
      "createdAt": "2026-07-20T10:20:00Z",
      "expiresAt": "2026-07-20T10:35:00Z",
      "packages": [
        {
          "name": "openssl",
          "fromVersion": "3.0.13-0ubuntu3.4",
          "toVersion": "3.0.13-0ubuntu3.5",
          "security": true,
          "downloadBytes": 1015808,
          "installedDeltaBytes": 0
        }
      ],
      "securityCount": 1,
      "downloadBytes": 1015808,
      "installedDeltaBytes": 0,
      "rebootRequired": false
    }
  }
}
```

### `updates.apply`

`POST /api/v1/updates/apply` accepts only the exact saved plan id:

```json
{ "requestId": "0f7d…", "planId": "pln_01ab…" }
```

Success accepts the operation immediately and returns its request and
plan ids. Follow `updates.progress` over WebSocket. Missing, expired or
mismatched plans fail with `409 conflict`; package apply operations
queue behind the worker. Package installation is not rollbackable.

### `files.write-privileged`

`POST /api/v1/files/write-privileged` with `X-Lumo-CSRF`:

```json
{
  "requestId": "8da2…",
  "path": "/etc/nginx/nginx.conf",
  "content": "dXNlciB3d3ctZGF0YTsK…",
  "expectedRevision": "sha256:9f2c…",
  "restartUnit": "nginx.service"
}
```

Only canonical existing regular files below `/etc` are eligible.
Symlinked paths are rejected, the revision precondition is mandatory,
decoded content is capped at 1 MiB, known formats are validated before
mutation, and the broker creates a rollback copy before the atomic
write. `restartUnit` is optional and must be a service unit name.

```json
{
  "ok": true,
  "data": {
    "file": {
      "path": "/etc/nginx/nginx.conf",
      "revision": "sha256:41b0…",
      "sizeBytes": 1654,
      "rollbackRef": "8da2…-f1c9…",
      "validation": { "kind": "nginx", "checked": true }
    },
    "restart": { "success": true, "unit": { "name": "nginx.service" } }
  }
}
```

## Phase 6 subset — system power

### `system.power`

`POST /api/v1/system/power` with `X-Lumo-CSRF` schedules one of the
two typed host power actions:

```json
{ "requestId": "bd70…", "action": "reboot" }
```

`action` is exactly `reboot` or `poweroff`. The agent forwards
`system.reboot` or `system.poweroff` to the broker; arbitrary command
or target strings are not accepted. Both operations require
`os.lumo.system.power` reauthentication and produce audit begin/end
rows. On success, logind schedules the transition a few seconds ahead
so the audit result and response can be persisted first:

```json
{
  "ok": true,
  "data": {
    "action": "system.reboot",
    "scheduledAt": "2026-07-20T18:42:10.125Z"
  }
}
```

The browser should expect its session and active streams to disconnect
when the scheduled transition begins. Replaying the same `requestId`
returns the stored result and does not schedule a second transition.

## Phase 6 subset — network rollback

### `network.snapshot`

`GET /api/v1/network` returns a read-only snapshot of live interfaces, default
gateways from the main routing table, and DNS servers. It does not create a
Netplan configuration or require Netplan. Refresh reads current system state.
The snapshot does not provide a mutation revision.

```json
{
  "ok": true,
  "data": {
    "dnsServers": ["1.1.1.1"],
    "dnsSource": "resolved",
    "interfaces": [
      {
        "name": "eth0",
        "hardwareAddress": "02:42:ac:11:00:02",
        "addresses": ["192.0.2.10/24"],
        "gateways": ["192.0.2.1"],
        "dnsServers": ["192.0.2.53"],
        "up": true,
        "loopback": false
      }
    ]
  }
}
```

Per-interface `dnsServers` come from systemd-resolved. Top-level `dnsServers`
are system-wide servers, obtained from systemd-resolved or `/etc/resolv.conf`
(`dnsSource` is `resolved` or `resolv.conf`). Resolver-file addresses may refer
to a local stub and are not presented as interface-specific upstream DNS.
A null `gateways` or `dnsServers` means the source is unavailable; an empty
array means the source was read successfully and reported no values.
`up` is the interface's administrative state, not proof of internet access.
IPv6 link-local gateways and DNS addresses include the interface zone.

The Settings overview has no network mutation controls. The existing backend
mutation contracts below are retained for compatibility and are not used by
this read-only view.

References: [Linux routing API](https://man7.org/linux/man-pages/man7/rtnetlink.7.html)
and [systemd-resolved D-Bus API](https://www.freedesktop.org/software/systemd/man/247/org.freedesktop.resolve1.html).

### `network.applyWithRollback`

`POST /api/v1/network/apply` accepts a typed Netplan subset. It does
not accept YAML, renderer passthrough or command strings:

```json
{
  "requestId": "4f62…",
  "expectedRevision": "sha256:41b0…",
  "confirmTimeoutSec": 90,
  "config": {
    "version": 2,
    "ethernets": {
      "eth0": {
        "dhcp4": false,
        "dhcp6": false,
        "addresses": ["192.0.2.10/24"],
        "nameservers": { "addresses": ["1.1.1.1"] },
        "routes": [{ "to": "default", "via": "192.0.2.1", "metric": 100 }]
      }
    }
  }
}
```

The broker creates a Netplan D-Bus configuration object, compares the
live merged revision, stages the typed delta and invokes `Try` with a
30–300 second timeout. Only one candidate may be pending. Netplan's
automatic revert is reinforced by a broker timer that calls `Cancel`
at expiry and verifies the restored merged revision before admitting a
new candidate.

```json
{
  "ok": true,
  "data": {
    "token": "9e0f…",
    "previousRevision": "sha256:41b0…",
    "expiresAt": "2026-07-20T20:14:30Z",
    "confirmTimeoutSec": 90
  }
}
```

After the browser reconnects, `POST /api/v1/network/confirm` with a
new request id and the returned token calls Netplan `Apply` and commits
the candidate. A missing or late confirmation restores the previous
configuration. Apply and confirm both require
`os.lumo.network.apply` reauthentication and are audited.

```json
{
  "ok": true,
  "data": { "token": "9e0f…", "confirmed": true }
}
```

## System settings

`GET /api/v1/system/settings` reads hostnamed and timedated over the system
D-Bus as the authenticated Linux user. It returns `hostname` (the persistent
static hostname, possibly empty), `runtimeHostname`, `timezone`, `ntp`,
`canNtp`, `ntpSynchronized`, `serverTime` (UTC RFC3339), and `revision`.
Hostname fields are read-only. The revision is a SHA-256 of the editable
timezone and NTP values; hostname changes, clock ticks and synchronization
status do not invalidate an edit.
`GET /api/v1/system/timezones` returns `{ "timezones": ["Etc/UTC", ...] }`
from timedated's installed zone list. Unsupported hosts return `unavailable`.

`POST /api/v1/system/settings` accepts a request ID, expected revision, and
exactly one typed change, for example:

```json
{
  "requestId": "settings-unique-request",
  "expectedRevision": "sha256:64-lowercase-hex-characters",
  "change": { "timezone": "America/New_York" }
}
```

The other supported change is `{ "ntp": true }`. Timezones must exist in
timedated's list. NTP changes require an available time service. Hostname
changes are rejected, including requests sent directly to the broker. Manual
clock changes are excluded.

The agent forwards `system.settings` with `arguments.change` and
`expected.revision` to the broker. The broker requires
`os.lumo.system.settings` authorization, uses the existing reauthentication
flow, serializes settings writes, compares the current revision immediately
before mutation, and audits the action. A stale revision returns
`stale_revision` without writing. Each request changes one system property
through one D-Bus setter; no multi-property transaction or root command is
exposed. The successful response is a fresh settings snapshot, verified
against the requested value. If verification fails after a setter, the
response asks the client to refresh because the change may already be applied.
These APIs cannot atomically exclude a simultaneous external D-Bus writer.

The Settings UI refreshes while visible and preserves dirty fields together
with their original revision. A conflicting edit offers an explicit reload
of current values. Local appearance and motion preferences stay in the local
browser. No Linux state is mirrored into browser storage.

Reference specifications: Ubuntu's systemd D-Bus documentation for
[hostnamed](https://manpages.ubuntu.com/manpages/noble/en/man5/org.freedesktop.hostname1.5.html)
and [timedated](https://www.freedesktop.org/software/systemd/man/org.freedesktop.timedate1.html).

## Server applications and App Library

All routes use the existing session, success/error envelope and CSRF rules.
See [SERVER_APPS.md](SERVER_APPS.md) for scope and design references.

### Catalog and installation

`GET /api/v1/apps` also reports `pi` installation for the current Linux account. Pi has a separate unprivileged install/update worker; the APT package-plan endpoint accepts Docker, Nginx and Git.

`GET /api/v1/apps` returns:

```json
{
  "canInstall": true,
  "apps": [{ "id": "docker", "installed": false }, { "id": "nginx", "installed": true }]
}
```

Installation detection checks the standard system executables, independently
of whether their services are running or the user can access them.
`POST /api/v1/apps/plan` accepts `{ "requestId": "unique-id", "appId": "docker" }`
or `nginx` or `git`. It forwards `apps.plan` to the privileged package worker and returns
`{ "plan": <updates.plan shape with appId> }`. Unknown app IDs and extra request
fields are rejected. Docker plans target `docker.io` and `docker-compose-v2`;
Nginx plans target `nginx`; Git plans target `git`, from configured APT sources.

Apply through the existing `POST /api/v1/updates/apply`, then subscribe to
`updates.progress` using the returned request ID. Plans expire after 15 minutes;
the worker re-simulates pinned app package versions before execution and fails
if the dependency/version set differs from the review. Removals are refused.
Closing an app does not cancel a running package operation. A worker restart
loses in-memory progress; the client must refresh installed state and prepare a
new plan instead of blindly repeating an uncertain installation.

### Pi installation and updates

The Pi catalog reports `canInstall` on Linux amd64 and arm64, independently of
system Node.js or npm. Install and update prepare a private Node.js 24.21.0
runtime under `~/.local/share/lumo/pi/runtime-v24.21.0`, using official
nodejs.org archives verified against pinned SHA-256 checksums before extraction.
Downloads and extraction are bounded, staged and validated before activation.
RPC sessions, provider setup and image compression use this runtime. Uninstall
moves it to Trash together with the managed Pi installation. `canUpdate` and
`canUninstall` apply only to Lumo-managed copies. Externally installed Pi can run
in the native app but must be maintained with its original package manager.

`POST /api/v1/apps/pi/plan` accepts `{requestId, operation}` (`install` or
`update`). It reads the installed version and official
`@earendil-works/pi-coding-agent` metadata from the npm registry. The resulting
`UpdatePlan` has a `pi_` ID and expires after 15 minutes.

`POST /api/v1/apps/pi/apply` accepts `{requestId, planId}` and returns immediately.
The worker installs the exact reviewed version with npm, `--ignore-scripts`,
and an account-local prefix at `~/.local/share/lumo/pi`. It checks Node's version,
refuses a changed installation, and verifies Pi's version after npm completes.
No elevated shell or automatic Node installation is involved. Command output
and execution time are bounded. Duplicate request IDs return the same job.

`GET /api/v1/apps/pi/progress?requestId=...` returns `UpdateProgress`. Operations
continue after App Library closes. History persists under
`~/.local/state/lumo/pi-operations.json`. Restarted jobs are reported as
interrupted, never silently retried. Close active Pi projects before updating
or removing Pi.

### Native Pi workspace

The authenticated per-user agent starts Pi using its documented JSONL RPC
interface. The browser accesses it through the typed data-source seam; it never
launches commands directly. Normal gateway authentication and CSRF protection
apply. Pi has the Linux account's ordinary filesystem and command permissions.

- `GET /api/v1/pi/providers` returns `{providers: [{id, name, methods:
  [{type: "oauth"|"api_key", label}], credential?}]}` from the installed Pi SDK.
  Enumeration uses `ModelRuntime` with network catalog refresh and initial
  availability resolution disabled; credential metadata never resolves keys.
- `GET /api/v1/pi/connections` returns `{providers: [{id, name, credential:
  "oauth"|"api_key", keyPreview?}]}` by reading the account's `auth.json` in
  its configured Pi agent directory. The Settings overview uses this endpoint
  without launching Pi, Node or the SDK. Literal API keys longer than eight
  characters expose only their final four characters after a fixed mask;
  shorter keys are fully masked. OAuth tokens and credential references are
  never returned or resolved. Missing storage returns an empty list; malformed
  storage returns a generic error. Responses use `Cache-Control: no-store`.
- `POST /api/v1/pi/auth/start` accepts `{requestId, provider, method, operation}`,
  with operation `login` or `logout`. It returns an account-bound flow
  `{id, status, events, prompt?, error?}`. There is one active flow per user.
- `GET /api/v1/pi/auth?id=...` polls that flow. Status is `working`, `done`,
  `error` or `cancelled`. Events carry sign-in links, device codes or progress;
  prompts have a stable ID and type `text`, `secret`, `manual_code` or `select`.
- `POST /api/v1/pi/auth/reply` accepts `{requestId, id, promptId, value}`.
  Stale prompt IDs and unsupported choices are rejected. Secret entries accept
  literal keys only, never command or environment substitutions. Submitted
  values travel through stdin and are never returned, logged or stored by Lumo.
- `POST /api/v1/pi/auth/cancel` accepts `{requestId, id}`. Closing provider setup
  cancels its process; abandoned flows expire after one minute without polling,
  and all flows have a ten-minute limit. Successful login/logout uses Pi's
  locked credential storage in its configured agent directory. Disconnect
  removes Pi's stored credential; external environment credentials and upstream
  authorization are unchanged. Native controls delegate provider-specific
  authentication to `ModelRuntime.login` and `logout` from the installed SDK,
  without loading project extensions or exposing general SDK calls. Only HTTPS
  sign-in links are rendered. Provider responses are not returned as errors.

- `GET /api/v1/pi/settings?kind=instructions|append` returns
  `{kind, path, content, revision, exists}` for user instruction files. The
  agent directory follows `PI_CODING_AGENT_DIR`, defaulting to `~/.pi/agent`.
  Relative custom directories are rejected because their meaning varies by
  project. Instructions use an existing `AGENTS.override.md`, `AGENTS.md`,
  `AGENTS.MD`, `CLAUDE.md`, or `CLAUDE.MD` in that order, otherwise `AGENTS.md`.
  The `append` kind uses `APPEND_SYSTEM.md`.
- `POST /api/v1/pi/settings` accepts `{requestId, kind, content, revision}`.
  Files are UTF-8, limited to 128 KiB, written with account-only permissions,
  and replaced atomically after checking the revision. Empty revision creates
  only a missing file; an existing or externally changed file returns conflict.
  Linked instruction files must be edited directly in Files. Credentials and
  arbitrary configuration paths are not exposed by these endpoints. Changes
  take effect on the next Pi process start.
- `GET /api/v1/pi/compaction?model=provider/modelId` reads account compaction
  defaults and the optional exact, case-sensitive model override. It returns
  `{model, enabled, reserveTokens, keepRecentTokens, defaultReserveTokens,
  defaultKeepRecentTokens, customized, revision}`. An empty model selects defaults.
  Omitted values use Pi's documented defaults: enabled, 16384 reserved tokens,
  and 20000 recent tokens. Each model budget inherits independently.
- `POST /api/v1/pi/compaction` accepts `{requestId, model, enabled, reserveTokens,
  keepRecentTokens, customized, revision}`. The toggle is account-wide. For a
  named model, `customized: false` removes its two budget overrides and restores
  inheritance. Budgets are non-negative safe integers. Writes merge only these
  fields into Pi's agent-directory `settings.json`, preserve unrelated fields
  and other models, check a whole-file revision, and replace the file atomically
  with account-only permissions. Invalid, oversized or linked files are rejected.
  Model/effort persistence and compaction writes share the same operation lock.
  These endpoints never return credentials or arbitrary settings fields.
  Changes apply at the next Pi process start; running conversations are not
  interrupted. Project settings retain Pi's native precedence.

  Pi Settings → Context & compaction displays the current model's reported
  capacity as read-only metadata and a threshold preview computed as capacity
  minus reserved tokens. The preview excludes project overrides, and the
  defaults preview also excludes model overrides. The reserve also affects
  Pi's summarization budget; it is not a separate percentage setting or a way
  to increase a provider's context capacity. Manual compaction remains available
  when automatic compaction is off. The specification is the installed Pi
  documentation: `settings.md` (Compaction), `compaction.md` (Configuration and
  per-model overrides), and `rpc-commands.md` (`get_state`).
- `GET /api/v1/pi/reference?project=...&session=...` resolves an existing saved
  conversation within that account's project session folder. It returns
  `{project, session, path, reader}` without loading the transcript into the
  browser. Invalid session filenames are rejected; archived files remain
  readable through the original reference. The reader is the installed `lumod`.
  Dragging a sidebar chat into the composer adds one removable chip,
  deduplicated by path, up to eight references.
  Prompt serialization uses one `[Lumo attachments]` block containing an ordered
  `items` array of files, folders and conversations. Each item appears once;
  conversation metadata shares the `reader` executable at the block level.
  Lookup guidance appears once for all chats and explicitly forbids reading or
  pasting an entire chat history file at once. File-only attachments omit chat
  guidance. Rendered messages, queued drafts and Edit & resend retain the chips.
  Duplicate additions do not move an item. Legacy conversation blocks (including
  `attachmentIndex` positions) and `read:` file lists remain readable and editable.
  History indexes and searches omit attachment guidance and skill metadata;
  expanding an individual entry preserves its original text.

  `lumod pi-history --file /absolute/session.jsonl --limit 8` provides a bounded
  JSON index of user messages and compaction/branch summaries. `--query TEXT`
  searches user/assistant text and summaries with 240-character excerpts.
  `--entry ID --offset N` expands one record by at most 4,000 Unicode characters.
  `--before LINE` pages older index/search results; limits are 1–20. Output
  includes IDs, parent IDs, line numbers and continuation offsets. Results span
  the saved branch tree; the model is instructed to check ancestry, treat all
  historical content as reference data, and retrieve only relevant pieces.
  The reader skips malformed or >2 MiB records, reports skipped records, and
  caps each scan at 128 MiB (`limited: true` means later data was not scanned).
  It uses ordinary account file permissions, rejects leaf symlinks, and never
  executes history content. This bounds reader output; the model still controls
  which follow-up lookups it makes.

  After the first message, one context ring beside the model selector shows
  Pi's reported current usage; its hover/focus tooltip contains percentage,
  token usage, maximum model context and conversation cost. Unknown usage is
  shown explicitly. Running sidebar chats display a spinner, replaced by the
  chat menu on hover/focus, with reduced motion respected. Workspace headings
  and chat names share the same text column. Each chat menu offers Rename,
  Pop out chat (or Return to Pi window), and Archive. Rename opens
  the selected session and uses Pi's documented `set_session_name` command;
  running chats cannot be renamed or archived.

  Assistant mode changes the presentation of the same mounted chat. Its Pi
  connection, live reply, approval mode, draft and attachments stay in place.
  The shared floating frame remains visible when the owning Pi window is
  minimized or another chat is selected. Its close control and Escape return
  the chat to the Pi window. Closing the owning Pi window still uses the normal
  guard for all running chats and unsaved drafts. Queued messages remain queued;
  completing an in-progress queued-message edit requires returning to Pi.
  Floating mode is remembered for browser refresh, while draft persistence
  follows the existing in-memory chat behavior.

  Workspace labels, assistant presentation and archiving are Lumo features.
  Pi's documented RPC supports session naming, switching, forking and cloning,
  but has no workspace-move command. Moving an existing conversation to another
  workspace would require a separate Lumo operation with explicit working-folder
  and history semantics. The current sidebar does not move project files or
  session histories between workspaces.

- `GET /api/v1/pi/sessions?project=...` lists Pi-written sessions for the project.
- `POST /api/v1/pi/sessions/archive` and `/pi/sessions/restore` accept
  `{requestId, project, session}` and return `{moved: true}`. Archive moves the
  original Pi JSONL into `.archive/` inside its project session folder; restore
  moves it back. Contents and filename stay intact. This is Lumo's archive
  feature; Pi has no native archive RPC command. Existing targets are never
  replaced. Both operations require the matching conversation's Lumo Pi process to exit;
  they share the installation/start lock. The browser stops its idle connection
  before moving and reopens the retained chat, or a fresh chat when archiving
  the current one. Drafts and attachments remain. Another window's connection
  blocks the move; active replies must be stopped first.
- `GET /api/v1/pi/sessions/archived` lists all archived chats for the account,
  including `project` from each original Pi session header. Project paths must
  match the containing project hash. No browser project list or extra database
  is needed. Archived chats remain listed when their project folder is removed.
- `POST /api/v1/pi/sessions/delete` accepts `{requestId, project, session}` and
  returns `{deleted: true}`. It permanently removes only an archived regular
  `.jsonl` file; active chats are not deleted by this endpoint. Missing archives
  succeed idempotently. Traversal, linked files/folders and non-regular files
  are rejected. Delete all confirms a snapshot of the listed archived chats,
  deletes them sequentially, and refreshes after any partial failure. New
  arrivals are not included. Project files, credentials and active chats stay.
  Exports, external backups and independently launched terminal Pi processes
  are outside this endpoint's scope.
- `POST /api/v1/pi/start` accepts `{requestId, project, session?, resume?, permissionMode?, rememberPermissionMode?}` and returns
  `{id, project, permissionMode}`. Permission modes are `read-only`, `ask`, and `auto`; unknown values are rejected.
  An omitted mode uses the saved conversation choice, then the account default
  (`ask` initially). A matching live resume keeps its current mode.
  `rememberPermissionMode: true` saves an explicitly supplied, confirmed choice
  as the default for new chats. Opening an older chat does not change that default.
  The account default and saved-chat modes use `lumoPermissionMode` and
  `lumoSessionPermissionModes` in Pi agent settings, alongside model and effort. Projects must be existing absolute directories (`~` means the
  account home). Session IDs are basenames from the project list; traversal and
  symlinked session files are rejected. A matching live `resume` process ID
  reconnects the same account, project and permission mode without starting
  another process. A different mode is rejected.
  The browser keeps each chat's process ID in tab storage for refresh recovery.
  Different saved chats may run concurrently in the same project; opening the
  same saved chat in a second process is rejected.
  Startup waits for the bundled extension to acknowledge the selected mode;
  missing or mismatched acknowledgements stop the process. The browser also
  checks the returned mode before enabling the composer. Each open chat remembers
  its mode in tab storage. Its selector appears immediately right of Add file.
  Changing modes while idle restarts Pi in the background with the same saved
  conversation. The conversation stays mounted, preserving scroll position,
  expanded details and the editable draft. Sending waits for permission
  acknowledgement; the selector is disabled during work, pending questions
  and queued-message editing or delivery.
  Read only exposes `read`, `grep`, `find`, `ls`, and `ask_user`, and blocks other
  tools through a pre-execution hook. Ask for approval adds `bash`, `edit`, and
  `write`, requiring explicit confirmation of the full input before each action.
  Rejection, cancellation and interruption block the action. Inputs too large to
  review are blocked and must be split into smaller actions. Approve for me runs
  those tools without confirmation, within the authenticated account's permissions.
  These are agent tool controls, not an operating-system sandbox; Pi still stores
  its own session records in all modes.
- `POST /api/v1/pi/answer` accepts `{requestId, id, questionId, value}`,
  `{requestId, id, questionId, confirmed}`, or `{requestId, id, questionId, cancelled: true}`.
  It returns `{accepted: true}` after writing a native `extension_ui_response`
  with the original question ID. Only a pending question in that account's
  running chat may be answered. Text must be nonblank and at most 10,000 bytes.
  Reusing the request ID safely retries a submission. Expired, answered and
  stopped questions reject new submissions. Answers are tool input, separate
  from ordinary messages and the message queue.
  Event batches and `get_messages` replies include a `questions` snapshot, so
  reconnecting with a newer event cursor still restores pending questions.
  Stop cancels pending dialogs; process exit or final settlement clears them.
  Lumo explicitly loads its bundled question, image and enabled desktop extensions
  with discovered and configured extensions disabled. The tool accepts one `question` and up to six
  optional `options`, awaits the answer, and returns the answer or cancellation
  to the agent. The card supports choices, a custom answer, Submit and Cancel
  without altering the message draft. Each concurrent question has its own ID.
  The same extension enforces permission modes. Approval dialogs show the proposed
  action with explicit Reject and Approve buttons and submit `confirmed: false`
  or `confirmed: true` respectively.
  Reference: [Pi extension UI protocol](https://pi.dev/docs/latest/rpc-extension-ui).
- `POST /api/v1/pi/command` accepts `{requestId, id, command}`. The allowlist covers
  prompt, steer, follow-up, abort, queue clearing, model/thinking selection,
  state/messages/models/thinking-level/statistics queries, rename, compaction,
  `get_fork_messages`, `clone`, and `fork` with a nonempty `entryId` (up to 128 bytes,
  no whitespace or path separators). Pi validates membership on the active
  branch. Fork and clone replies include the adapter's `eventCursor`, allowing the
  browser to skip old output before rendering the new chat. History replies
  (`get_messages`) include the cursor captured when the reply arrives, so
  reconnecting loads saved messages without replaying their previous events.
  The browser-facing `get_state` omits `sessionFile` until the native session
  file exists as a regular file. Pi may allocate its filename before saving the
  first conversation entry; such a filename must not be persisted as a resumable
  chat or reused when restarting to change permissions or context settings.
  Unknown command fields and arbitrary shell/RPC commands are rejected.
- `GET /api/v1/pi/events?id=...&after=0` long-polls ordered events and returns
  `{events, cursor, closed}`. The buffer holds at most 512 events or approximately
  8 MiB; a cursor gap returns conflict so the client can reopen saved history.
- `POST /api/v1/pi/stop` accepts `{id}` and stops that subprocess group.

Pi also provides personal prompt templates and image attachments:

- `GET /api/v1/pi/templates` returns `{templates: [{name, content, revision, path}]}`
  from direct Markdown children of the account's Pi agent `prompts` directory.
  It accepts at most 100 templates totaling 2 MiB; each must be UTF-8 text up to
  128 KiB. Symlink files are omitted and a symlink prompts directory is rejected.
- `POST /api/v1/pi/templates` accepts `{requestId, name, content, revision, delete?}`.
  Names contain 1–64 letters, numbers, underscores or hyphens and start with a
  letter or number. Chat actions `undo`, `rename` and `compact` are reserved.
  Saves are atomic, private to the account and reject stale revisions. Deletion
  moves the file to recoverable Trash. The editor preserves other frontmatter.
  The browser includes an editable default `/init` prompt unless overridden by
  a personal template. Templates insert editable composer text and never send
  automatically. Typed slash invocations expand arguments before sending or
  queueing; positional arguments, quoted arguments, defaults and slices follow
  [Pi prompt templates](https://pi.dev/docs/latest/prompt-templates).
  This UI manages personal templates; project and package template discovery is
  not enabled. Changes apply to the next catalog load without restarting Pi.
- `POST /api/v1/pi/images` accepts `{requestId, content}` with base64 image bytes.
  PNG, JPEG, GIF and WebP uploads are limited to 8 MiB decoded (12 MiB JSON body).
  Content sniffing rejects other formats. The response is `{path}` for a private
  file under `~/.local/state/lumo/pi-attachments`. Request replay returns the same
  result. Files persist for saved conversation references; removing an attachment
  from a draft does not delete its server file. Pasted and dropped images use
  the same ordered, deduplicated attachment references as server files.
  The agent reads the attached image through its normal read tool.

Chat renders native base64 image blocks and local Markdown images. Local previews
use the existing account-scoped `/files/read?preview=image` API (32 MiB limit).
Relative paths resolve against the chat project. Attachment thumbnails open
Preview; transcript images expand in place. External image URLs remain links and
are never fetched automatically. Invalid images display an unavailable placeholder.

`GET /api/v1/pi/image-settings` returns `{mode: "original" | "quality90", revision}`.
`POST /api/v1/pi/image-settings` accepts `{requestId, mode, revision}`. The account
preference is `lumoImageQuality` in Pi's agent-directory `settings.json`; an absent
preference uses Original. Writes preserve unrelated settings, compare revisions,
and share the Pi operation lock. Selecting Quality 90 prepares Sharp 0.35.4 in
the account's existing managed Pi prefix, using npm with install scripts disabled.
Preparation failure retains the previous preference. Routine reads never install
dependencies or contact external services.

Each managed Pi process loads Lumo's image extension through the documented
[Pi context hook and custom session entries](https://pi.dev/docs/latest/extensions).
It replaces native user, tool-result and other image blocks only in model context.
Quality 90 encodes static PNG, JPEG, GIF and WebP as WebP at quality 90, keeps
resolution, honors orientation and preserves alpha at quality 100. Images under
4 KiB, over 32 MiB or 16 megapixels, animated images, invalid images, encoder
failures and conversions that increase size retain their original bytes. Pi's
own image sizing and provider validation continue to apply.

The extension stores each image occurrence's chosen mode and exact compressed
bytes in native custom session entries, which are excluded from model context.
Changing the preference affects newly encountered images in all chats. Existing
images retain their bytes across requests, reopening and branches; histories
created before this feature retain Original. Reading the same file in a new
message uses the current preference. Source files, native message images and
browser previews stay intact. This preserves existing image prefixes for provider
prompt caching; it does not guarantee a provider cache hit or avoid resending
request bytes. Encoding is performed once per image occurrence and its stored
output is reused even if the encoder changes later.

The command allowlist includes `set_auto_retry` with a required boolean `enabled`
and `abort_retry` without arguments. The browser retains the retry preference per
chat and reapplies it when reconnecting. Event batches and history replies include
`retry: null | {attempt, maxAttempts, retryAt, errorMessage, source}`. `retryAt` is
Unix milliseconds; `source` is `response` or `summary`. Snapshots restore the
active attempt without replaying old events. The browser shows temporary,
collapsible attempt rows beside Thinking and tool steps. Native retry completion,
final settlement and process exit remove these rows; no additional retry history
is stored. The existing composer Stop button aborts the current operation. Final
retry failures remain inline in the transcript. Reference:
[Pi retry commands](https://pi.dev/docs/latest/rpc-commands).

`get_session_stats` also includes optional `metrics` with `inputTokens`,
`cachedTokens`, `outputTokens`, `responseMs`, and `timedResponses`. The bundled
extension calculates these for assistant messages on the current conversation
branch. Cache hit rate is `cachedTokens / inputTokens`; the input total includes
uncached input, cache reads and cache writes. Missing usage is omitted from the
calculation. A reported zero cache count means no cache hits were reported, not
proof that a provider supports cache reporting.

Response speed is the sum of output tokens divided by the sum of timed response
seconds, including initial model latency and excluding tool execution and user
approval waits. Only completed `stop`, `toolUse` and `length` responses with
positive reported output and measured duration contribute. Reasoning tokens are
already part of output and are not counted twice. Compaction and nested tool
model calls are excluded. Each duration is saved as a native custom
`lumo-response-timing` entry linked to its assistant message; custom entries are
excluded from model context. Reopening, permission changes and branching restore
measurements from the current branch without a separate conversation database.
Historical responses without recorded duration contribute cache usage but not
speed. The browser shows both figures in a small line beside the mode and model selectors in the input
box, uses an em dash for unavailable values, and updates after responses complete.

Commands are correlated by ID. Streaming deltas build message blocks; final
messages replace partial text. Edit & resend uses Pi's native fork before the
selected user message, preserving the original session. The browser pauses old
event delivery, loads the new history, then sends the revision and resumes from
the fork event boundary. Failed sends preserve the edited draft. Stop and Take
back use `clear_queue`'s returned text, never a stale browser queue copy. Stop
then awaits `abort`. Editing a queued message takes only that entry out of the
native queue and loads its text and attachments into the main composer. Remaining
messages continue normally. Sending the edit reconciles with the native queue
and restores its original relative position among entries still waiting; already
consumed messages are never recreated. A prompt with `streamingBehavior` queues
while busy and starts normally when idle. Cancel restores the original message
through the same path. The previous unsent draft is restored after submission;
failed submissions preserve the revision and recover other unsent entries.
These operations do not roll back filesystem changes. Branch chat uses native
`clone` to duplicate the active branch at its current position without sending
a prompt. It is offered on the latest completed assistant reply. Earlier-message
branching remains available through Edit & resend.
Tool events expose arguments, progress, result,
and failures. `agent_settled` signals completion, including queued work and
retries. Selecting a saved session starts it with Pi's `--session` option.
The browser sends one notification through the shared system notification center
when an observed run finishes, fails or is stopped. Notifications identify the
chat and workspace, including background and minimized chats. Retry attempts
stay quiet until settlement. Unexpected process exits or lost event connections
also notify; idle startup, settings changes and historical replies do not.
Successful model and effort selections also save the confirmed model, provider,
and supported thinking level in Pi's agent-directory `settings.json` as defaults
for new conversations. Other settings and other models' effort preferences are
preserved. Saved conversations restore their own native Pi session choices;
opening them does not update the new-conversation defaults. Explicit project
settings retain Pi's normal precedence over agent-directory defaults.
Sessions are Pi-owned JSONL files in
`~/.local/state/lumo/pi-sessions/<project-hash>/`; Lumo does not duplicate their
conversation state in a database.

There are at most eight subprocesses per Linux user. Switching chats preserves
running processes, event streams, drafts, attachments and queued messages. Idle
background chats release their process and reopen their saved session when selected.
Closing a Pi window stops its processes after the running-work confirmation; a
disconnected browser lease expires after two minutes. Running
chats and active provider setup count toward agent activity. Credentials
remain managed by Pi through its public SDK; provider setup never opens a
terminal. Native RPC
starts with discovered/configured extensions, prompt templates, and trust-gated
project resources disabled. Lumo explicitly loads only its bundled question
and permission extension and supports its native dialog requests. Custom slash commands remain
unavailable.

Reference specifications: [Pi RPC](https://pi.dev/docs/latest/rpc),
[commands](https://pi.dev/docs/latest/rpc-commands),
[events](https://pi.dev/docs/latest/json), and
[installation](https://pi.dev/docs/latest/quickstart),
[provider authentication](https://pi.dev/docs/latest/providers),
[SDK](https://pi.dev/docs/latest/sdk), and
[user configuration](https://pi.dev/docs/latest/configuration). The Lumo UI and Go adapter
are independent implementations using those public protocols.

### Containers

`GET /api/v1/containers` returns `{ status, message, version, containers }`.
Status is `ready`, `not-installed`, `stopped`, `permission-denied` or
`unavailable`. Each container includes `id`, `name`, `image`, `state`, `status`
and `project` (the Compose project label, or empty). Reads use the authenticated
Linux user's system Docker socket permissions; no remote socket is accepted.

`GET /api/v1/containers/detail?id=<64-hex-ID>` adds `revision`, `created`,
`startedAt`, `exitCode`, `ports` (`container`, `address`, `host`) and `mounts`
(`type`, `source`, `destination`, `writable`). Environment values are omitted.
The Engine API is negotiated between v1.41 and v1.45.

`GET /api/v1/containers/logs?id=<64-hex-ID>` returns `{ text, truncated }` for
at most 200 recent lines, bounded to 256 KiB. Multiplexed Docker logs are decoded;
TTY output is plain text. Unsupported logging drivers produce a readable error.
Logs are fetched on demand rather than streamed continuously.

`POST /api/v1/containers/action` accepts:

```json
{
  "requestId": "unique-id",
  "id": "64-lowercase-hex-container-ID",
  "action": "restart",
  "expectedRevision": "sha256:64-lowercase-hex-characters"
}
```

Only `start`, `stop` and `restart` are supported. The agent forwards a typed
`containers.<action>` broker request. Polkit authorization, existing requester
socket access and a current container revision are required. The result is
the refreshed detail. A changed revision returns `409 stale_revision`.

### Docker resources

`GET /api/v1/docker/resources` reads the local Docker Engine's `/system/df`
and network inspection endpoints as the authenticated Linux user. It returns:

- `images`: ID, tags, created timestamp, size, sharedSize, referencing container
  names, and revision.
- `volumes`: name, driver, scope, creation time, size, referencing containers,
  removable flag, and revision. Removal is available only when local scope and
  the engine reports zero references, including stopped containers.
- `networks`: ID, name, driver, scope, internal flag, subnets, connected container
  names, removable flag, and revision. Built-in and nonlocal networks are protected.
- `containers`: ID, writableSize, and rootSize, in bytes.
- `imageBytes`: engine layer total with shared image layers counted once;
  `buildCacheBytes`: sum of reported cache records; `sampledAt`: UTC timestamp.

Missing or negative sizes become `null`, never zero. Build-cache and image
figures may overlap; clients must not present their sum as total disk usage.
Bind mounts and container log files are not included in writable-layer figures.
Driver options, environment values, and other secret-bearing engine fields are
not returned. Storage measurement is explicit/on-open, not an idle polling job.

`POST /api/v1/docker/resource` accepts `requestId`, `kind` (`container`, `image`,
`volume`, `network`), `action` (`create`, `remove`), `id`, and `revision`.
Creation supports named local volumes and local bridge networks only, with
`revision: "absent"`; names are 2–128 letters, digits, underscores, dots, or
hyphens and must start with a letter/digit. Removal requires a current SHA-256
revision; images use full `sha256:` IDs, containers/networks use 64-hex IDs,
and volumes use names. No force, driver options, arbitrary engine endpoints,
container creation, bulk prune, or exec arguments are accepted.

The broker validates and serializes Docker mutations, applies
`os.lumo.containers.manage`, verifies the requester's existing socket access,
audits the operation, and rechecks the resource/references before mutation.
Running containers and referenced images/volumes are refused. Container removal
uses `force=false&v=false`, preserving volumes; image removal does not prune
parents. Resource deletion is permanent and requires explicit UI confirmation
with the resource name. External Docker actions can still race an engine request;
Docker's own non-force conflict checks remain the final guard.

### App Library updates

`POST /api/v1/apps/plan` also accepts `operation: "update"`. Clients refresh APT
indexes first, then review the returned package versions and download size.
Docker updates target installed packages from the detected Docker family
(`docker.io` or `docker-ce`), with installed Compose/runtime/CLI companions;
Nginx updates target the installed `nginx` package. Unsupported/manual installs
are rejected, not replaced with a different package distribution. Update planning
uses `--only-upgrade --no-remove`; applying uses the existing reviewed, pinned
package plan and progress stream, including dependency revalidation. An empty
plan means up to date with configured APT repositories, not with every upstream
release. Engine updates can restart Docker and interrupt containers. They do not
pull application images or recreate containers.

Reference: [Docker Engine API v1.45](https://docs.docker.com/reference/api/engine/version/v1.45/).
The original UI uses separate resource tables and an explicit measurement time,
with Engine maintenance located in App Library.

### Websites

`GET /api/v1/websites` returns `{ installed, sites, warnings }`. Site records
contain `id`, `path`, `name`, `source`, `revision`, `managed` and optional
`definition`. Reads cover the main configuration, `conf.d/*.conf` and
`sites-enabled`, limited to 100 files of at most 128 KiB each. Symlink targets
must remain inside the Nginx directory. Files matching Lumo's exact supported
format are editable; custom files retain their path as ID and are read-only.

`GET /api/v1/websites/logs?kind=access|error` returns `{ text, truncated }`,
bounded to 64 KiB from the standard shared log. Normal Linux read permissions
apply; arbitrary paths and symlinked log files are refused.

`POST /api/v1/websites/save` accepts:

```json
{
  "requestId": "unique-id",
  "id": "notes",
  "expectedRevision": "absent",
  "definition": {
    "domain": "notes.example.com",
    "kind": "proxy",
    "port": 3000,
    "root": "",
    "enabled": true
  }
}
```

Use `absent` only when creating, otherwise the current `sha256:` revision.
Proxy sites require a local port 1–65535 and an empty root. Static sites require
`kind: "static"`, `port: 0` and an existing folder resolving below `/var/www/`
or `/srv/`. IDs are lowercase alphanumeric/hyphen slugs, at most 63 characters.
Domains must be valid lowercase DNS names with at least two labels.

The broker writes `/etc/nginx/conf.d/lumo-<id>.conf`, keeps a backup, runs
complete configuration validation, verifies the new file is included and
requests reload. Failed validation or reload restores the prior file. Success
returns `{ site, rollbackRef, reloaded }`; `reloaded: true` means the reload
request was accepted, not that domain routing has been verified. Revisions
detect external edits before writing but cannot atomically exclude an
administrator changing Nginx files concurrently. New sites use HTTP port 80.

### App removal

App Library entries always show details, never launch an application. Installed
apps expose an Uninstall action. Docker and Nginx use `POST /api/v1/apps/plan`
with `operation: "uninstall"` (`"install"` remains the default). The returned plan
includes its operation and every package that apt proposes removing, including
dependents. Application of the reviewed plan uses the existing authenticated,
authorized and audited `/updates/apply` flow. The worker rechecks package names
and installed versions before removal and rejects changed plans. It uses apt
`remove`, never `purge` or `autoremove`; normal uninstall keeps app data and
configuration.
Removal plans that require installing other packages are rejected.

`POST /api/v1/apps/pi/uninstall` accepts `{ "requestId": "unique-id" }`.
It runs as the signed-in Linux user and moves the managed installation directory
`~/.local/share/lumo/pi` to Trash. Normal uninstall keeps settings and sessions.
External installations and project folders are preserved.
The catalog's Pi entry reports `canUninstall`; externally managed copies
show an unavailable Uninstall button with instructions to use their installer.
The response's `uninstalled` flag reports whether another detected copy remains.
This endpoint uses the gateway's authentication and CSRF checks and the agent's
request-id replay protection. No privileged broker action is added for Pi.

### Clean uninstall and protected app Trash

The uninstall dialog defaults to **Uninstall**, which keeps settings and data.
**Clean uninstall** additionally moves app settings, caches and stored data to
recoverable Trash. It never deletes project folders or website content.

- `/updates/apply` accepts optional `clean: true` for a Docker or Nginx removal
  plan. The broker checks cleanup eligibility before removing packages, then
  moves data only after successful removal, inside the package worker's operation
  lock. Cleanup failures are reported separately from successful package removal.
- Docker cleanup covers `/etc/docker` and `/var/lib/docker`, including local
  container, image and volume data. The engine's `/info` must confirm its standard
  data root. Custom roots, shared containerd image storage, active live-restore
  workloads, symlinked storage and remaining mount points are refused. Bind-mounted
  project data, remote volume data and shared `/var/lib/containerd` stay untouched.
- Nginx cleanup covers `/etc/nginx`, `/var/cache/nginx`, `/var/lib/nginx` and
  `/var/log/nginx`; `/var/www` and `/srv` are preserved. App installation uses
  dpkg's `--force-confmiss` to recreate missing package defaults after cleanup.
- `/apps/pi/uninstall` accepts optional `clean: true`. It also moves
  `~/.pi/agent` and Lumo's Pi session directory to home Trash. Credentials,
  conversations, and installed Pi packages under that default agent directory
  are included. Custom agent directories and project-local `.pi` resources
  are preserved. A failed batch attempts to restore items already moved.

Protected Docker/Nginx bundles are stored beside the broker audit database in
`app-trash/<uid>/apptrash_<random-id>/`, with root-owned private metadata and
original ownership/modes preserved. The broker never writes root-owned recovery
files into a user-controlled directory. Metadata is synced before moves, and
partially moved bundles remain discoverable after interruption. No cross-device
copy-and-delete fallback is used.

`GET /apps/trash` on the broker socket lists only the peer UID's bundles. The
agent aggregates those with personal Trash in `GET /api/v1/trash`. IDs prefixed
`apptrash_` route restore/delete through typed broker actions
`apps.trashRestore` and `apps.trashDelete`, using the existing package policy,
reauthentication, audit and request replay protection. Caller-supplied paths and
UIDs are never accepted. Recovery is restricted to stored allowlisted paths,
rejects changed revisions and existing destinations, and rolls back partial
restores where possible. Restoring data does not reinstall the application.

## Account skills

`GET /api/v1/skills` returns `{path, skills, limited}`. Each skill has
`id`, `name`, `description`, `path` and an optional `issue`.
`GET /api/v1/skills/detail?id=<folder-name>` adds `body` (Markdown without
frontmatter) and `raw` (the original document). Both use the usual envelope.

Discovery runs as the authenticated Linux user and reads only immediate
`~/.agents/skills/<folder>/SKILL.md` files. It does not scan project folders,
other agent locations, supporting resources or scripts. Missing directories
return an empty list. No filesystem watcher or periodic scan is started.
Each request checks at most 512 folder entries and reads at most 256 KiB per
document; `limited` indicates the directory-entry limit was reached. Linked
files must remain inside the skills root. Non-regular, oversized, non-UTF-8
and malformed documents are reported with an issue instead of executing
anything. Metadata follows the Agent Skills YAML-frontmatter specification:
https://agentskills.io/specification.

### App update history

`GET /api/v1/apps/update-history` returns `{ entries: AppUpdateHistoryEntry[] }`.
Each entry has `requestId`, `appId`, `completedAt`, `success`, optional `error`,
and `packages` with reviewed old/new versions. The read-only broker endpoint
`GET /apps/update-history` uses Unix peer credentials to return only the caller's
last 50 completed Lumo app-update attempts, newest first. Entries join existing
package-application audit results to the same user's app plans; checks, pending
jobs, installations, removals and other users' actions are excluded. Successful
and failed attempts remain available after a broker restart. This is an audit
view, not a second store of installed state or a record of updates made via SSH.

App Library separates Discovery from Updates. Discovery uses an adaptive card
grid; Updates refreshes APT metadata once, checks installed managed apps in
sequence, shows per-app failures separately from up-to-date results, and reviews
a fresh plan before applying. Pi uses versioned account-local npm installation
and participates in Update all. Its account-local update history is merged with
the broker history. Pi checks also work when APT management is unavailable.

### Standard file locations

`GET /api/v1/files/locations` returns `{ "locations": [{ "id": "documents", "name": "Documents", "path": "/home/user/Documents" }] }` in the normal data envelope.
The per-user agent reads `$XDG_CONFIG_HOME/user-dirs.dirs` (default `~/.config/user-dirs.dirs`) without executing it. It reports existing directories only, honors customized and localized paths, skips locations disabled by pointing to Home, and deduplicates paths. For unconfigured locations it checks conventional names under Home. It never creates directories.

`GET /api/v1/files/locations/settings` returns all standard locations with
`defaultPath`, `exists`, and `enabled`, plus a configuration `revision` and existing
parent-folder `choices`, including writable mounted storage as well as common data
paths. System, temporary and read-only mounts are excluded.
`GET /api/v1/files/locations/plan?id=documents&path=...&revision=...` checks an
individual folder's proposed absolute destination without moving anything and
returns `files`, `bytes`, and `create`. The destination's parent must exist.
It rejects overlapping locations, unsupported file types, and any existing
destination entry with the same name. Omitting `id` retains the common-parent API.

`POST /api/v1/files/locations/settings` accepts `id`, `path`, `expectedRevision`,
and `requestId`. It rechecks the move, creates the requested missing directory,
moves existing contents without overwriting, and atomically updates only that
folder's XDG assignment. Other folders and configuration lines are preserved.
With `remove: true`, the configured folder and its contents move to recoverable
Trash and its XDG assignment is disabled by pointing to Home. Missing or already
disabled folders are disabled without moving anything. Removing Home, Trash,
configuration-containing or overlapping standard directories is rejected.
Restoring a folder from Trash does not automatically re-enable its XDG assignment.
Omitting `id` retains the common-parent behavior; `remove` requires `id`.

An existing same-name destination file or folder blocks the entire operation.
Ordinary failures roll back staged moves. A per-user recovery record allows the
next location read or change to recover an interrupted move or removal.
Cross-filesystem moves copy regular files and symbolic links with permissions and
modification times, retaining originals until configuration commit. Special files
are rejected. No privileged broker operation is used; filesystem permissions
remain authoritative.


## Git repositories

Git is an APT-managed App Library application (`git`). Install, update and
uninstall use the existing broker package-plan flow. Normal uninstall keeps
configuration and repositories; clean uninstall moves `/etc/gitconfig` to
recoverable app Trash. Account Git settings, credentials, SSH keys and all
repositories are preserved.

All Git routes run in the authenticated per-user agent, as that Linux user,
behind the gateway session and CSRF checks. No privileged broker command is
used for repository operations. Paths identify existing, accessible working
repositories; bare repositories are not editable through this interface.

- `GET /api/v1/git/repository?path=<absolute-folder>` returns `path`, `branch`,
  `head`, `revision`, `upstream`, `ahead`, `behind`, `branches`, `remotes`,
  `files`, `history`, `branchDetails` and `operation`. Branch details include
  `name`, full `ref`, optional `remote`, last-commit ISO `date`, `upstream`,
  and `default`. Default markers come from the preferred remote’s symbolic
  HEAD; no default is guessed when it is unavailable. An empty `branch` means detached HEAD;
  an empty `head` means no commits. Files have `path`, optional `original`,
  porcelain `index` and `worktree` status characters, and `conflict`.
  History contains the most recent 50 commits with `id`, `subject`, `author`,
  ISO `date` and `body`. Counts compare HEAD with its configured upstream,
  independently of the remote selected in the UI.
- `GET /api/v1/git/diff?path=...&file=...&commit=...&staged=true|false`
  returns `{text, truncated}`. Working and index diffs are separate; a full
  commit ID requests its patch. Untracked regular files have a bounded text
  preview; binary and nonregular files show an explanation. External diff
  drivers and text conversion are disabled. Paths are always literal.
- `POST /api/v1/git/action` accepts `{requestId, path, revision, action}`.
  Actions: `stage`/`unstage` with `file` or `files` (up to 10,000 paths); `commit` with `message`;
  `switch`/`create-branch` with a local `branch`; `switch-remote`/`merge`
  with a full branch ref from `branchDetails`; `abort-merge` without extra
  fields; `fetch`/`pull`/`push` with `remote`.
  `init` creates an empty repository on `main`; `clone` also accepts `url`.
  These two actions use an empty revision and an absolute, new destination
  `path` inside an existing parent directory. Existing destinations are
  refused, including empty directories. Failed operations remove only an
  empty destination; any partial repository is retained and reported.
  Clone supports HTTPS, SSH and local server paths without recursive submodules.
  Mutations are serialized per agent, replayed by request ID and rejected
  with `stale_revision` if the inspected snapshot changed (except new repository creation). The revision
  includes HEAD, branch refs and their object IDs, configured remote names,
  status, staged object IDs, and changed-file metadata.
  Git's own index/ref locks also apply; external edits are not locked for
  the duration of an API request.

Batch staging validates every selected path against the same revision before
issuing one Git command. The header checkbox applies to visible, non-conflicting
files and leaves already-selected partial staging intact.

Commit uses the existing index, preserving unstaged edits. It respects the
account's author, signing and hook configuration. Active merge/rebase,
cherry-pick, revert and bisect operations must be finished in Terminal.
Branch changes, merges and pulls require a clean working tree. Remote
checkout creates a local tracking branch and rejects local-name collisions.
Merge requires UI confirmation, permits fast-forward or a merge commit,
disables automatic stashing, and refuses to overwrite ignored files.
Conflicts remain visible with a confirmed Abort merge action; conflict
resolution and completion use Terminal. Abort is offered only while
`MERGE_HEAD` exists and warns that resolution edits will be discarded. Pull explicitly uses
fast-forward only, disables automatic stashing and never creates a merge.
Pull and push use the tracked branch when it belongs to the selected remote,
otherwise the current local branch name. Push publishes only HEAD to that branch,
sets its upstream, and never forces or mirrors. The UI asks before publishing.

Remote operations use the Linux account's configured credentials. Terminal
prompts and SSH password/host-key prompts are disabled; configure credentials
and trusted host keys in Terminal first. Commands have a 90-second timeout;
refresh after a timeout to inspect the outcome. Output is bounded to 4 MiB,
and the UI limits diff rendering to 6,000 lines. Git errors remain visible
without clearing the commit draft. The UI polls the open repository every
15 seconds while visible and refreshes on browser focus; it does not maintain
a separate server repository database. Recent paths are account-scoped UI
preferences. The UI defaults to the branch’s tracking remote, then origin or
the first configured remote. Remote selection appears in Sync options only
when multiple remotes exist. A single toolbar action follows the branch state:
Push when there are unpublished commits (including when both branches have new
commits), Publish branch when it has no tracking branch on the selected remote,
Pull when only behind, otherwise Fetch. Fetch updates the state; pulling requires
a separate click. A rejected push stops and shows the error, preserving local
commits without automatically pulling, merging or forcing. Refresh the state and
merge remote changes through the branch menu before retrying a rejected push.
Fetch stays available in Sync options.
Create/clone defaults to `~/GitHub`, created through the ordinary Files API on
submission if absent. A successfully used destination is remembered per account;
opening existing repositories does not change this preference.

The design references are `DESKTOP_STYLE.md`, `DESIGN_PRINCIPLES.md`, and the
standard Git CLI documentation for status, diff, commit, switch and remote
operations at https://git-scm.com/docs. The original layout groups repository
and branch controls in a compact toolbar, a Changes/History list and commit
composer at left, and a readable diff at right. Shared neutral tokens keep
both themes consistent; an original coral branch icon identifies Git.

### Shared Pi context budget

The compaction response may include `usageBudget: {mode: "percent" | "tokens", value}`.
The account-level POST (empty `model`) accepts this optional object: percentages
are integers from 1 to 99; token counts are positive safe integers. Saving it
replaces account per-model compaction token overrides while retaining unrelated
keys. It is stored as `lumoContextBudget` in the account Pi settings file.

On a fresh Lumo Pi process start, Lumo queries configured model definitions and
the selected model through Pi RPC. It translates the shared budget to native
per-model `reserveTokens`, caps recent tokens at the usable budget, and restarts
the idle process if these settings changed. No prompt or provider request is
sent. New models are included on the next fresh start. After saving through Lumo,
the UI reopens the current saved conversation once the process is idle and its
queued messages have completed, preserving the composer draft. It then reloads
the effective session statistics and settings revision. Fixed budgets leave a 16,384-token response reserve, capped at one quarter of
the window for small models (minimum one token). Unknown capacities retain Pi's native fallback.
Project settings retain Pi's normal precedence.

Session statistics may include `compaction: {enabled, threshold}`. This reflects
the account and project compaction settings captured when the process started,
resolved for its current model and reported context capacity. Reconnecting to
an existing process retains its original settings. The field is omitted if the
context window or effective settings cannot be resolved.

## Lumo Use

Lumo Use is Lumo's optional, bundled Pi extension for text-based control of the
connected desktop. It requires no screenshots, browser extension or browser
process on Ubuntu. `lumo_observe` returns visible windows, text and controls;
`lumo_act` operates an observed control and returns the updated snapshot. The
browser remains the owner of its live UI state. Observations are produced on
request, bounded to 24,000 characters and never continuously streamed or stored
in a duplicate desktop-state database.

Controls are complete JSON records with explicit `target`, `label`, `role` and
`disabled` fields, plus `bounds` (`{x,y,w,h}`), the owning `window` ID when present,
and `covered` (whether the control's center is blocked). Selection, expansion and
value information are included where present. Geometry uses CSS pixels from the
viewport's top-left, with x rightward and y downward. A `Desktop geometry:` JSON
record gives `viewport` and `workArea`, excluding the menu bar and dock. `Window:`
JSON records give live bounds, z order, protection, focus, placement mode, app
minimum sizes and drag/resize capabilities. `Overlay:` records describe occupied
popups, dialogs and desktop overlays without their private content. Protected Pi
and terminal windows are obstacles, never action targets. Placement must account
for other windows and overlays; the returned geometry establishes the actual
result after each action. Geometry actions preserve window layer order.
Actions must copy the exact `target` and `label` string values from the same record
in the latest observation. Brackets, extra whitespace and inferred labels are
rejected rather than normalized. Observations expire after 60 seconds. Validation
errors distinguish invalid format, unknown or stale IDs, expired observations,
label mismatches, disabled or unavailable controls, and changes to label, value
or state. They explain the correction to make before retrying and confirm when
no action was performed. Browser errors are delivered to the model through the
native tool result.

`GET /api/v1/pi/extensions` returns `{lumoUse, questions, extensions, revision}`. Lumo Use
is enabled by default. Each optional local extension has `{id, name, enabled}`;
paths stay on the server. The inventory reads the account extensions directory
and local paths in Pi settings without running the CLI or downloading packages.
`POST /api/v1/pi/extensions` accepts `{requestId, lumoUse, questions, extensions, revision}`,
where each extension choice is `{id, enabled}`. It validates the current inventory
and stores disabled IDs as `lumoDisabledExtensions` in Pi settings. It preserves
other Pi settings through the existing atomic settings writer. The revision
checks only extension settings, so changes to model, effort or other settings
do not cause false conflicts. Image and compaction settings use the same scoped
revision rule; a concurrent edit to the same settings still requires a reload.
The Lumo Use preference is account-wide and stored as `lumoUse` in the account's Pi agent
`settings.json`. Disabling immediately revokes pending desktop requests for that
account. Enabling loads the extension when a chat starts or restarts while idle.
Extension toggles remain editable during a run; the last saved choice applies
when each chat becomes idle. Active idle chats restart, while background idle
chats release their process and load current choices when reopened. Conversations
and drafts are retained. Enabled local extensions load through explicit
`--extension` arguments; disabled extensions are omitted. Their tools retain
Lumo permission enforcement. Reattachment reports `extensionsChanged` if the resumed process needs
an idle restart. The account-wide `questions` preference defaults to enabled and
is stored as `lumoQuestions`. Disabling it removes the `ask_user` tool on the next
idle restart while retaining approval enforcement, response metrics and dialogs
requested by other extensions. Approval handling follows the chat permission mode.
The Extensions pane also contains an Image compression toggle: enabled selects
`quality90`, disabled selects `original` through the existing image-settings API.
It retains the recorded representation of earlier images and applies the choice
to new images. Images has no separate settings tab.

The extension's source is embedded in `lumod` and regenerated privately in the
managed session directory at startup. Pi installation updates do not own either
this source or its saved preference. Startup requires the extension's native
`lumo-use=ready` status acknowledgement when enabled. This checks loading, not
future API compatibility; supported Pi updates must pass the offline extension,
RPC and browser integration checks.

`POST /api/v1/pi/start` additionally accepts a tab-scoped `clientId`. Only a
process started by that client exposes desktop requests to it; resuming from a
different client does not transfer desktop control. The response includes
`lumoUse`, the effective availability for that client. `GET /api/v1/pi/events`
accepts the same `clientId` and includes an authoritative `desktop` array of
unclaimed requests belonging to that client. A browser Web Lock prevents copied
session storage in a duplicated tab from reusing the original tab identity.

The trusted extension uses the documented RPC input-dialog transport with the
reserved title `Lumo Use: ` followed by a JSON action. The server projects these
requests separately from user questions. They expire after 30 seconds and clear
on abort, final settlement or process exit. Allowed actions are `observe`,
`click`, `double_click`, `fill`, `press`, `scroll`, `drag` and `resize`. An action includes an
opaque `target` from the latest snapshot and its exact `label`, making the
existing approval card reviewable. Optional fields are `text` (up to 4,000
characters), `key`, `deltaX` and `deltaY` (integer pixel deltas within ±2,000).
Resize instead requires both `width` and `height` (integer CSS pixels from 1 to
8,192), uses a floating window-title target, and cannot mix dimensions with other
actions or drag deltas. Sizes clamp to app minimums and the usable desktop area;
placement may shift to keep the resized window within that area. Compact screens,
maximized and tiled windows cannot drag or resize until a floating desktop layout
is available. Changes to the viewport, windows or occupied overlays invalidate
geometry actions until a fresh observation.
There is no script, CSS selector, URL navigation or privileged-command parameter.

`POST /api/v1/pi/desktop/claim` accepts
`{requestId, id, clientId, desktopId}` and atomically claims a pending request.
A new claim for an already claimed request fails; retrying the original request
ID replays its response. The browser executes only after a successful claim.
`POST /api/v1/pi/desktop/result` accepts the same identity fields plus `{text,
error}` and delivers one native input-dialog response. Results are bounded to
96,000 UTF-8 bytes, supporting the 24,000-character observation limit. Missing,
expired, unclaimed, foreign-client and stopped requests reject results. Both
endpoints use normal account authentication, CSRF protection and idempotency.
Actions with an uncertain outcome are never automatically replayed.

The browser serializes desktop requests. Controls are live DOM element references
with a snapshot-specific ID; changed labels, values, states, disabled controls,
removed elements and expired snapshots require another observation. Covered
controls reject pointer-like actions. Fill replaces text through normal input
events. Press supports Enter, Escape, Space, arrows, Home, End, Tab, Backspace and
Delete; browser-native defaults that cannot be reproduced must be performed by
the user. Drag supports floating window titles and zoomed image preview panes.
OS file choosers, browser permissions, external pages and embedded iframe content
are outside this controller's scope.

Only an active chat in a visible, connected tab operates its desktop. Stop
cancels local work before sending Pi's abort command. Pi windows and their popup
controls, terminal windows, login, reauthentication, password and file inputs
are excluded. The agent cannot press its own Approve button. Read only exposes
`lumo_observe`; other modes expose `lumo_act` through the same pre-execution
approval hook used for other Pi actions. Observed page text remains untrusted
content rather than authorization or instructions.

Reference specifications: [Pi extensions](https://pi.dev/docs/latest/extensions),
[Pi RPC extension UI](https://pi.dev/docs/latest/rpc-extension-ui), and standard
DOM events. The original design uses the existing authenticated Pi event stream
and live Lumo browser, keeping traffic text-only and operating the user's actual
windows without maintaining another desktop session.

## Calendar and Reminders

These capabilities run as the authenticated Linux user. Reminders are local to
Lumo; no Google Tasks scopes or API calls are used. See [CALENDAR.md](CALENDAR.md)
for account setup, recurrence semantics and notification delivery.

`GET /calendar?from=<RFC3339>&to=<RFC3339>` accepts an exclusive end and a range
of at most 370 days. Optional `google=0` skips all remote reads for local reminder
and account views. It returns `{collections, items, occurrences, google,
googleError?}`. Collections have `id`, `name`, `color`, `kind` (`event` or
`reminder`), `provider` (`local` or `google`), and `readOnly`. Local items include
completed reminders, exclude deleted items, and retain their original series
anchor. Google items are expanded instances within the requested range.
Occurrences have an additional `occurrenceId` and expanded start/end values.

Items have `id`, `revision`, `collectionId`, `kind`, `title`, `notes`, `location`,
`start`, `end`, `due`, `allDay`, `timeZone`, `repeat`, `repeatUntil`,
`alertMinutes`, `flagged`, `priority`, `completed`, `deleted` and optional
`recurrence`. Timed dates are RFC3339 instants; all-day events use `YYYY-MM-DD`
and an exclusive end date. Reminder `due` may be empty, a date, or an RFC3339
instant. Time zones are IANA names. Repeat is `none`, `daily`, `weekly`,
`monthly`, or `yearly`. Priority is `none`, `low`, `medium`, or `high`.

`POST /calendar` carries `requestId`, `action` and action-specific fields:

- `save`: an `item`; omit its ID to create, otherwise include its current revision.
- `delete` or `restore`: `id` and current `revision`. Restore is local only.
- `complete`: a local reminder's `id` and current `revision`; toggles completion.
- `collection`: a local collection's `name`, `color` and `kind`.

Mutations return the item, or an empty item for collection creation; refresh the
snapshot to read the new collection ID. Stale revisions return `conflict` (409).
Local deletions are reversible. Google changes use ETags and affect the selected
instance; invitations are not sent. Google rejects writes to read-only calendars.
Google IDs begin with `g:` and encode the calendar and optional event IDs.

`POST /calendar/notices` carries `requestId` and returns `{notices}` with
`{id,title,body}` entries. A private, transactional delivery ledger prevents
repeat claims by multiple browser tabs. It reports local alerts due in the last
24 hours; the browser polls once per minute while signed in.

`GET /calendar/google` returns `{configured, connected, name, redirectUri}`.
`POST /calendar/google` carries `requestId` and one of:

- `configure`: `config: {clientId,clientSecret,redirectUri}` for a Google Web
  application OAuth client. Configuration changes require disconnecting first.
- `connect`: returns `{url}` for Google's official authorization-code endpoint.
- `disconnect`: revokes the grant and retains the client configuration.

Configure/disconnect return `{status}`. Credentials and tokens are never returned.
The callback validates a one-use, expiring state and exchanges a code with PKCE.
The gateway keeps normal session cookies Strict. A ten-minute HttpOnly Lax cookie
restricted to the exact Google callback path carries the authenticated session
through Google's cross-site return, then is cleared. It cannot authenticate other
API routes and does not bypass the state check. Logout clears it too.

Pi's optional Calendar & Reminders extension invokes `lumod calendar list|change`
with a single bounded JSON object on stdin. It shares the same per-user store
and validation as these endpoints, without a shell or privileged broker operation.

## Desktop app packages

Desktop apps use `/api/v1/desktop-apps`, independently of server software in
`/apps`. Requests retain gateway authentication and CSRF checks. The per-user
agent and `lumod desktop-app` share an account-local package store and file lock.

- `GET /desktop-apps` returns `{apps, builds}`. Entries contain a validated
  manifest and digest; installed entries also have revision, enabled, previous,
  and history. Builds are staged, immutable snapshots.
- `POST /desktop-apps/action` accepts `{requestId, action, id, digest?, revision,
  clean?}`. Actions are install, restore, disable, enable and uninstall. Install
  grants the declared API v1 metrics and/or app-owned storage capabilities. The trusted UI
  presents this access before installation. Replay keys bind to the complete
  request; stale revisions and conflicting reuse fail.
- `POST /desktop-apps/launch` accepts `{digest, preview}` and returns `{token,
  handshake, url}`. Installed launches require an enabled current version; preview launches
  require a staged build. Tokens stay in the trusted shell, expire after one
  hour, and are scoped to the gateway session and exact artifact.
- `GET /desktop-apps/frame?frame=...` serves the generated app document with a
  route-specific CSP, `sandbox allow-scripts`, and `frame-ancestors 'self'`.
  Two script/style policies combine a per-document nonce with an inline-only
  restriction, so learning the nonce does not permit external script URLs.
  The frame identifier is separate from the capability token and is session
  scoped. It only loads the document. The parent checks the sending frame and
  fresh handshake before establishing the capability message channel.
- `POST /desktop-apps/call` accepts `{token, method, params?}`. Declared
  `system.metrics.read` returns CPU percentage, memory usage, capacity and sample
  time, and does not accept params. Declared `app.storage` enables
  `app.storage.get` (no params) and `app.storage.set` (params `{revision,value}`).
  Both return `{revision,value}`; empty storage has revision `""` and value `null`.
  Set atomically replaces at most 64 KiB of JSON, rejecting stale revisions with
  `conflict` (409). It derives the app identity from the launch, never params.
  Preview storage is isolated in memory per launch and starts empty; installed
  storage is account-local and survives activation changes. Clean uninstall
  moves it to Trash. Activation authorization and saves share the store lock.
  Revocation and activation changes invalidate existing installed launches.
  Capability calls are bounded to 30 per ten seconds per launch; metrics also
  retain their 250 ms spacing. The frame receives error messages and protocol
  error codes; capability tokens stay in the trusted host.
- `POST /desktop-apps/report` accepts `{token, status, message}` for bounded
  ready/error diagnostics. `POST /desktop-apps/close` revokes a launch.

The fixed offline build supports `src/main.js` or `src/main.tsx` plus CSS.
TSX uses embedded React 18.3.1 and TypeScript 5.7.3 with syntax diagnostics;
only static imports from `react`, `react-dom/client`, `react/jsx-runtime`, and
`@lumo/ui` are accepted. It does not read project build configuration or execute
app source. No package hooks, downloads, local module resolution or custom
build scripts are available. SDK discovery includes `entries` and pinned
`reactSDK` metadata. Compiled output remains bounded by the existing bundle limit.
`lumod desktop-app api|create|build|list|install|restore|status` reads one JSON
object on stdin and writes one JSON result. Create accepts optional `template`
(`pulse` by default, `counter` for saved app data, `notes` for editing, or `react` for TSX). Pi uses this adapter with its
existing permission enforcement. Preview uses the client-owned Lumo desktop
request transport with `{action:"app_preview", target:<digest>, label:<name>}`.

The frame SDK sends `{type:"dirty", value:<boolean>}` only over its dedicated
message port. This state belongs to that window and does not grant server access.
The shell guards close/quit/logout and management actions while dirty or saving,
and retains dirty frames across catalog activation changes. The existing server
revocation checks still apply. `lumo.setDirty(false)` clears the guard; apps must
not clear it merely because a save was attempted. Browser unload warnings are
best effort and do not replace durable saves.
