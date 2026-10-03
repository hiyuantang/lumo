# Git

This is Lumo's shipped Git app plugin. Its source and app-specific styles
live in `src/`. It uses the shared host API through `@lumo/sdk/*` and keeps
existing server data and authorization unchanged.

Build only this app from the repository root:

```sh
npm run build:plugins -- git
```

The output is `public/plugins/git/`. Increase the manifest version for a
release. Reopen the app after deployment to use its new bundle.
See [Shipped app plugins](../../docs/SHIPPED_APP_PLUGINS.md) for the SDK contract,
independent deployment, rollback and verification commands.
