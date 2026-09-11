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

The companion settings page at <https://nick1udwig.github.io/bibble/config/> lets the reader use Gothic 14, 18, 24, or 28 (Very large) in regular or bold, defaulting to 18 Bold.
Rectangular headers follow the reader profile; round headers use compact Gothic 14 Bold so the time and full reference remain inside the display. Selection grids stay at Gothic 24 Bold for consistent legibility.
Pages use the selected bitmap font’s glyph widths, descenders, and display geometry. Each screen packs as many whole verses as fit. A verse that does not fit the remaining rows starts on the next screen; only verses longer than a full screen continue across pages. The watch and settings preview share these line breaks.
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

## Knowledge base

We use [GitKB](https://gitkb.com/) to retain project requirements and decisions. Agents should start with [AGENTS.md](AGENTS.md); the final reading and typography requirements live in `specs/reading-and-typography`.

[Install the GitKB CLI](https://gitkb.com/docs/getting-started/installation/) on macOS/Linux:

```sh
curl -fsSL https://get.gitkb.com/install.sh | bash
```

Then, from a fresh clone with the CLI on your PATH, set up this repository's KB in one line:

```sh
git-kb restore .kb/backups/bootstrap.json && git-kb code index --index-only src scripts tests docs wscript
```

Git tracks the KB configuration, agent instructions, and portable backup in `.kb/backups/bootstrap.json`, so these travel with the repository on GitHub. The working KB store, caches, and editing workspaces remain local and ignored. GitKB has its own commit history; after updating it, refresh the backup before committing the corresponding Git changes. See [.kb/README.md](.kb/README.md) for details. Restore is for a fresh/empty KB, not for overwriting newer local work.
