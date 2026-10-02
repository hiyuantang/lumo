Generated app compiler and runtime bundles go here. Run npm run build:app-sdk
with the repository's installed, locked dependencies. These files are embedded
in lumod by Go. Missing bundles produce an explicit TSX build error; ordinary
JavaScript app builds continue to work. Do not edit generated files.
