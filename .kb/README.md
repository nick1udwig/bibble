# Bibble knowledge base

Start with `git-kb show specs/reading-and-typography --json` for the final user requirements. The requirements supersede the earlier rejected approaches documented in `decisions/pagination-evolution`.

Useful documents:

- `context/immutable/project-brief`: project purpose and architecture.
- `context/extensible/repository-inventory`: links to all 68 imported Git paths.
- `context/overridable/current-state`: implementation, documentation discrepancies, and verification limits.
- `repo/readme` and `repo/files/**`: revision-stamped source/document snapshots and binary-asset references.

Use `git-kb search 'query' --json` for text search and `git-kb code symbols src/c/main.c --json` for code symbols. After code changes, refresh the index with:

```sh
git-kb code index --index-only src scripts tests docs wscript
```

The KB is local, with no sync remote or embeddings configured. Its documents are committed in GitKB history. Mutable store/cache/workspace files are ignored by Git. `backups/bootstrap.json` preserves the exported documents and KB history in a portable file; it does not include the derived code index. On a fresh checkout with an empty local KB, restore and reindex (do not restore over newer local work):

```sh
git-kb restore .kb/backups/bootstrap.json
git-kb code index --index-only src scripts tests docs wscript
git-kb verify --full --json
```

Snapshots reflect Git revision `55236ff9ec2cbe30eba178856ea45c52f9771d1c`. Edit application code in its original repository paths; refresh imported references intentionally. See `AGENTS.md` in this directory for GitKB document workflows.

After committing KB document changes, run `git-kb backup --output .kb/backups/bootstrap.json` and include the updated backup in the relevant Git commit. GitKB commits are separate from Git commits; only the refreshed backup carries document updates to GitHub. Repository-wide agent discovery is provided by the root `AGENTS.md`.
