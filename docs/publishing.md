# Publishing Notes

## App Icon

Use [`assets/bibble-icon.png`](../assets/bibble-icon.png) as the app store submission icon.

The Pebble launcher/menu icon is bundled from [`resources/bibble-menu-icon.png`](../resources/bibble-menu-icon.png) through the `APP_ICON` resource in `package.json`.

Generated icon sizes:

- [`assets/bibble-icon.png`](../assets/bibble-icon.png): 1024x1024
- [`assets/bibble-icon-144.png`](../assets/bibble-icon-144.png): 144x144
- [`assets/bibble-icon-80.png`](../assets/bibble-icon-80.png): 80x80
- [`resources/bibble-menu-icon.png`](../resources/bibble-menu-icon.png): 25x25

## Build

```bash
npm run build:config:docs
npm test
npm run build:watch:release
```

Configure GitHub Pages to deploy from the `master` branch's `/docs` directory. Then verify the
configuration page at <https://nick1udwig.github.io/bibble/config/> after publishing.

The release build minifies the packaged companion JavaScript and omits its source map from the PBW. The matching map remains available at `build/release/pebble-js-app.js.map` for debugging.

## Phone Install

```bash
npm run deploy:phone
```

## Store Listing

Use [`docs/app-store-listing.md`](./app-store-listing.md) as the working source for store submission metadata.
