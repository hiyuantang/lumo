# Shipped app plugins

Lumo ships Calendar, Skills, Git, Docker, Nginx and Monitor as independently
built app plugins. Files, Preview, Terminal, Pi, Settings, App Library and Trash
remain built in. All window apps use the same registration and window lifecycle,
with an error boundary around each window. Built-in renderers load on demand.
The desktop, authentication, authorization and recovery remain host services.

## Package ownership

Each `apps/<name>/` directory contains `lumo.plugin.json` and its own source and
app-specific styles. The manifest declares the stable app ID, name, version,
window sizes, host API version and optional underlying Ubuntu package.
Existing IDs are preserved: Docker uses `containers`, Nginx uses `websites`,
and Monitor uses `home`, so saved layouts and navigation continue to work.

Packages import only their own relative modules, React and `@lumo/sdk/*`.
The offline builder rejects other runtime imports, including relative paths
outside the package. The SDK shares the host's React instance, controls, file
picker, menus, state, notifications, authentication prompts and typed data API.
The explicit adapter modules live in `src/platform/sdk/`; add new host exports
there rather than importing desktop implementation files into an app.
`tsconfig.json` checks both host and plugin sources together.

The source manifest is part of host registration. Changing an app's identity,
icon, default window dimensions, dependency or background registration requires
a host release. Changing the existing app's screens, styles and behavior within
host API v1 requires only its own build and deployment.

Calendar owns a separate background entry for reminder notifications. The host
starts it after login even when the Calendar window is closed. Server-side
calendar storage and synchronization retain their existing lifecycle. The
background entry updates on the next desktop reload; window entries update on
close and reopen. Open windows continue using their loaded code and drafts.

These packages are trusted Lumo code with desktop access. They are deployed by
the server administrator, like a frontend release. This SDK is a compatibility
contract, not a permission sandbox. Ubuntu actions still go through the same
authenticated server APIs and privileged broker. No arbitrary server code or
root command endpoint is added. Pi-created `local.*` apps retain the isolated
iframe runtime, declared capabilities and per-account App Library lifecycle.
Do not install unreviewed generated code as a trusted shipped plugin.

## App Library

Discovery lists all six shipped apps alongside Pi and locally created apps.
Each app has one entry and a details page with its active app version and Open.
Calendar, Skills and Monitor are included with Lumo. Git, Docker and Nginx retain
their existing Ubuntu package installation controls; Open is available when
the required package is installed. Their app version comes from the deployed
frontend manifest, independently of the Ubuntu package version.
View → Refresh rereads these manifests without loading the apps themselves.
A failed or incompatible manifest is shown as unavailable, and Open is disabled
until a successful refresh. Other apps remain usable.

## Build one app

From the repository root, with the locked dependencies already installed:

```sh
npm run build:plugins -- skills
```

The output is `public/plugins/skills/manifest.json` plus content-addressed
JavaScript and CSS files. Calendar also has a separate background bundle.
The builder does not install dependencies or contact external services.
`npm run build` builds all six plugins and the host. Vite copies their artifacts
into `dist/plugins/`, which the normal Docker and embedded builds include.
`npm run dev` prepares all plugins before starting. After editing an app during
development, rebuild that app and close and reopen its window.

Built artifacts use the host's React and SDK exports instead of bundling a
second React instance or copying host implementation code. `hostApiVersion: 1`
is required. Keep existing exports compatible; incompatible SDK changes need a
new host API version and corresponding package rebuilds.

## Deploy and recover

The gateway checks `/var/lib/lumo/plugins` for overrides, then falls back to the
bundled version. `lumod gateway -plugins <directory>` changes that directory.
Only the six registered package names, manifests and hashed JS/CSS assets are
served. Escaping symbolic links and other paths cannot expose outside files.
Keep this directory administrator-owned and readable by the gateway user.

On the machine holding the built artifacts and the gateway's plugin directory,
run with the permissions needed to write that directory:

```sh
npm run deploy:plugin -- skills /var/lib/lumo/plugins
```

The deployer validates asset hashes and compatibility before changing the active
manifest, retains the preceding manifest and publishes the new one atomically.
No gateway restart or desktop rebuild is needed. Close and reopen Skills to
load the update. Data stays in the existing server storage and app preferences.
App Library's Git/Docker/Nginx installation controls still manage their Ubuntu
packages; they do not deploy these frontend bundles.

Restore the preceding override or return to the version shipped with Lumo:

```sh
npm run deploy:plugin -- skills /var/lib/lumo/plugins --rollback
npm run deploy:plugin -- skills /var/lib/lumo/plugins --bundled
```

Keep old hashed assets while clients may still use them. Code rollback does not
reverse data changes; updates must preserve existing data formats. A missing or
incompatible window package shows an in-window error and retry action. Built-in
Files, Terminal, Settings and App Library remain available for recovery.

## Verification

```sh
npm run build
node --test tests/plugin-packages.test.mjs
npx playwright test tests/ui/plugins.spec.ts tests/ui/calendar.spec.ts tests/ui/skills.spec.ts tests/ui/git.spec.ts tests/ui/monitor.spec.ts tests/ui/server-apps.spec.ts tests/ui/server-apps-states.spec.ts
```

`server/internal/static/plugins_test.go` checks live asset overrides, atomic
manifest replacement, invalid paths and escaping symlinks. Package tests cover
all six artifacts, validation before deployment, rollback and bundled recovery.
Browser checks cover independent update/reopen/rollback, failure containment,
on-demand loading and existing app workflows. Shared integration tests remain
under `tests/ui` because they also exercise the desktop, Files and App Library.

The design follows Lumo's App Platform, Protocol, Privilege Model and Desktop
Style specifications. It preserves server authorization and existing app data,
while separating frontend release artifacts from the desktop binary.
