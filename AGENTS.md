# Bibble agent instructions

This repository uses [GitKB](https://gitkb.com/) for persistent requirements, decisions, and project context. Consult it before changing code.

1. Read `.kb/README.md` for setup and `.kb/AGENTS.md` for the document workflow.
2. Run `git-kb board --json`, then read the relevant documents. Start with:
   - `git-kb show specs/reading-and-typography --json`
   - `git-kb show context/overridable/current-state --json`
   - `git-kb show decisions/pagination-evolution --json` before changing pagination.
3. Search with `git-kb search 'topic' --json` and use the code index for symbol relationships. Imported source snapshots are historical; edit the original repository files.
4. Update affected KB requirements/decisions when behavior changes, commit only the KB documents you changed, and refresh the code index when needed.
5. After committing KB changes, refresh the portable backup with `git-kb backup --output .kb/backups/bootstrap.json` and include it with the relevant Git changes. GitKB commits alone do not update the GitHub snapshot.

On a fresh clone with an empty local KB, restore `.kb/backups/bootstrap.json` as described in the README. Do not restore the bootstrap snapshot over an existing KB with newer work. If the CLI is unavailable, follow the installation link in README.md and report any setup blocker rather than silently ignoring the requirements.
