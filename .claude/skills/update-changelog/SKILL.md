---
name: update-changelog
description: >-
  Draft a CHANGELOG.md entry for the current branch's work in this repo's
  established Keep-a-Changelog voice, derived from the diff and commit messages.
  Use after finishing a slice and before opening a PR, e.g. "/update-changelog".
disable-model-invocation: true
---

# Update changelog

`CHANGELOG.md` is the running log of shipped slices and is maintained by hand.
Draft the next entry in the existing house style — don't restructure the file.

## Steps

1. **Read the current format**: open `CHANGELOG.md` and study the top
   `## [Unreleased]` block and the most recent released section. Match its
   conventions exactly:
   - Keep a Changelog headings (`### Added` / `### Changed` / `### Fixed` /
     `### Removed`), SemVer at release time.
   - The repo's voice: a short prose lead describing the slice, then bulleted
     detail with **bold lead-ins**, concrete file paths in backticks, and the
     relevant `EXP-NN` / `D-NN` / Phase identifiers.
   - Note back-compat guarantees explicitly when generator/schema shapes change
     (the existing entries call out "byte-identical fixtures" preservation).

2. **Gather what changed**:
   ```
   git -C "$CLAUDE_PROJECT_DIR" log --oneline origin/main..HEAD
   git -C "$CLAUDE_PROJECT_DIR" diff --stat origin/main...HEAD
   ```
   Read the commit messages and the meaningful diffs. Map the work to the right
   EXP/Phase identifiers (see CLAUDE.md §Phasing and §EXP-IDs). If the branch
   touches generators, personas, or the spec pin, say so and name the invariant
   guarantees preserved.

3. **Draft the entry** under `## [Unreleased]`, choosing the right
   `### Added/Changed/Fixed` subsection (create it if absent). Lead with one or
   two sentences of context, then bullets. Reference personas/endpoints by their
   real ids and link behaviour to its EXP/D number.

4. **Apply it** to `CHANGELOG.md` with an Edit (insert under `[Unreleased]`,
   above older unreleased entries). Show the user the inserted text and ask them
   to confirm wording before they commit — they own the final voice.

## Guardrails

- Don't fabricate scope: describe only what the diff and commits actually show.
- Don't bump the version or cut a release section unless the user asks.
- Keep claims about counts (personas, endpoints) consistent with what the diff
  changed; if unsure of a total, state the delta, not an absolute.
