# Bibble

KJV Bible reader for Repebble core devices.

The native watch app is C. On first use, PKJS downloads and normalizes the KJV text into persistent phone-side storage. Later launches restore the corpus marker without downloading or parsing the whole Bible, and books are hydrated only when requested. PKJS owns reference parsing and chapter paging. The watch keeps an eight-entry LRU page cache and prefetches an asymmetric reading window (four pages forward and two backward) over AppMessage.

Publishing metadata and app icon assets are in [`docs/publishing.md`](docs/publishing.md).

## Build

```sh
npm run fetch:kjv
npm run generate:data
npm test
npm run build:watch
```

The generated Bible file in the PBW contains metadata only. The KJV text comes from [`nick1udwig/bible` on `master`](https://github.com/nick1udwig/bible/tree/master) and is cached persistently by PKJS after the first successful download. Runtime downloads, data-generation provenance, fetch tooling, and cache versioning all use `src/common/kjv-source.js` as their source definition.

## Deploy

```sh
npm run deploy:phone
```

This builds `build/bibble.pbw` and installs it to the paired phone with `pebble install --phone`.
