# Bibble

KJV Bible reader for Repebble core devices.

The native watch app is C. PKJS downloads the KJV text at startup, keeps it in phone-side state, and owns reference parsing and chapter paging. The watch keeps an eight-entry LRU page cache and prefetches an asymmetric reading window (four pages forward and two backward) over AppMessage.

Publishing metadata and app icon assets are in [`docs/publishing.md`](docs/publishing.md).

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
