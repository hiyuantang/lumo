# Docker app plugin

This directory owns the app's frontend and any app-specific backend or Pi
extension. `lumo.plugin.json` describes the complete versioned package.

Build from the repository root:

```sh
npm run build:plugins -- docker
npm run build:packages -- -app docker
```

See [App plugins](../../docs/SHIPPED_APP_PLUGINS.md) for ownership, the host
contract, deployment, rollback and verification. Licensed AGPL-3.0-only.
