# Bibble

KJV Bible reader for Repebble core devices.

The native watch app is C. PKJS downloads the KJV text at startup, keeps it in phone-side state, owns reference parsing, chapter paging, and a page cache; the watch requests one page at a time over AppMessage.

## Build

```sh
npm run fetch:kjv
npm run generate:data
npm test
npm run build:watch
```

The generated Bible file in the PBW contains metadata only. The KJV text comes from `thiagobodruk/bible`'s `en_kjv.json` source and is downloaded into PKJS state when the app starts.

## Deploy

```sh
npm run deploy:phone
```

This builds `build/bibble.pbw` and installs it to the paired phone with `pebble install --phone`.
