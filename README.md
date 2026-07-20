# Bibble

KJV Bible reader for Repebble core devices.

Hold Select to query with dictation.
Speak a book/chapter/verse, or a phrase to search for in the text.

## Build

```sh
npm run fetch:kjv
npm run generate:data
npm run build:config:docs
npm test
npm run build:watch
```

The generated Bible file in the PBW contains metadata only.
The KJV text comes from [`nick1udwig/bible` on `master`](https://github.com/nick1udwig/bible/tree/master) (forked from [`thiagobodruk/bible`](https://github.com/thiagobodruk/bible)) and is cached persistently by PKJS after the first successful download.
Runtime downloads, data-generation provenance, fetch tooling, and cache versioning all use `src/common/kjv-source.js` as their source definition.

## Deploy

```sh
npm run deploy:phone
```

This builds `build/bibble.pbw` and installs it to the paired phone with `pebble install --phone`.

## App Description

The companion settings page at <https://nick1udwig.github.io/bibble/config/> lets the reader use Gothic 14, 18, or 24 in regular or bold, defaulting to 18 Bold.
Rectangular headers follow the reader profile; round headers use compact Gothic 14 Bold so the time and full reference remain inside the display. Selection grids stay at Gothic 24 Bold for consistent legibility.
Chapters are paginated lazily for the selected reader profile; changing it never rebuilds or redownloads the KJV corpus.

The native watch app is C.
On first use, PKJS downloads and normalizes the KJV text into compressed persistent phone-side storage, then immediately builds a compact, compressed, positional verse index.
Later launches restore the completed index and its decoded shards into memory without rebuilding or parsing the whole Bible.
Existing plaintext book caches migrate in place while an incompatible index is rebuilt once from the cached corpus, without redownloading it.
Search uses Lunr's finite-state term dictionary for bounded edit-distance matching, exact-first posting-list intersection, BM25 relevance, and index-resident phrase/proximity ranking.
Only the displayed hit verses are hydrated from the corpus.
PKJS also owns reference parsing and chapter paging.
The watch keeps an eight-entry LRU page cache and prefetches an asymmetric reading window (four pages forward and two backward) over AppMessage.

Holding Select starts dictation.
Spoken Bible references still navigate directly; other phrases search the full KJV.
Search results arrive five at a time, show a verse reference and compact excerpt with matching terms in bold, and open the selected verse when tapped or selected.
