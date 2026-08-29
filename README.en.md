# @dsh-external/dsh-file-trace

A DSH Web UI file-trace plugin: like Codex / Claude Code, it **records and reviews every file the model reads, writes, or edits**. A "File trace" button (with an operation-count badge) appears in the session-header utilities; clicking opens a right-side drawer that lists all operations grouped by file, and selecting one shows the numbered content or a **line-by-line diff**. Zero core changes — a pure browser-half plugin.

**English** | [简体中文](./README.md)

## Install (profile mode)

```sh
# 1. Clone the repository (any of the three mirrors); build artifacts are in-tree
git clone https://github.com/omdsh-dev/dsh-file-trace.git
cd dsh-file-trace && pnpm install

# 2. Install into the web profile (equivalent to pnpm add under $DSH_HOME/profiles/web)
dsh plugin --profile web add link:/path/to/dsh-file-trace
#   or a pinned-tag git dependency:
#   dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:omdsh-dev/dsh-file-trace#v0.1.2'
```

Config line (`$DSH_HOME/profiles/web/cordis.patch.yml`, hot-reloaded, no restart needed):

```yaml
- insert:
    - id: dsh-file-trace
      name: '@dsh-external/dsh-file-trace'
```

> The plugin must be built (`pnpm run build` produces `lib/client.js`); cloned repos already ship the artifacts, but rebuild after editing source.

> **Install tips**: pnpm 11 may block node-pty build scripts on first install — run `pnpm approve-builds --all` under `~/.dsh/profiles/web` and re-run the install; then **hard-refresh the browser** (Ctrl/Cmd+Shift+R).

### Prompt install (let DSH install it)

Paste this prompt into any DSH session and the agent installs it for you:

> Install the dsh-file-trace plugin (DSH file trace: records and reviews model file reads/writes/edits with diffs):
> 1. Run `dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:omdsh-dev/dsh-file-trace#v0.1.2'` (the first run may fail because pnpm 11 blocks node-pty build scripts)
> 2. Under `~/.dsh/profiles/web`, run `pnpm approve-builds --all` (approve the build scripts)
> 3. Re-run the install command from step 1
> 4. Append the `- insert` plugin row (id: dsh-file-trace, name: '@dsh-external/dsh-file-trace') to `~/.dsh/profiles/web/cordis.patch.yml`, then remind me to hard-refresh the browser (Ctrl/Cmd+Shift+R)
> On errors, first check the known limitations in the README at https://github.com/omdsh-dev/dsh-file-trace.


ofile mode)

```sh
# 1. Clone the repository (any of the three mirrors); build artifacts are in-tree
git clone https://github.com/omdsh-dev/dsh-file-trace.git
cd dsh-file-trace && pnpm install

# 2. Install into the web profile (equivalent to pnpm add under $DSH_HOME/profiles/web)
dsh plugin --profile web add link:/path/to/dsh-file-trace
#   or a pinned-tag git dependency:
#   dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:omdsh-dev/dsh-file-trace#v0.1.2'
```

Config line (`$DSH_HOME/profiles/web/cordis.patch.yml`, hot-reloaded, no restart needed):

```yaml
- insert:
    - id: dsh-file-trace
      name: '@dsh-external/dsh-file-trace'
```

> The plugin must be built (`pnpm run build` produces `lib/client.js`); cloned repos already ship the artifacts, but rebuild after editing source.

> **Install tips**: pnpm 11 may block node-pty build scripts on first install — run `pnpm approve-builds --all` under `~/.dsh/profiles/web` and re-run the install; then **hard-refresh the browser** (Ctrl/Cmd+Shift+R).

### Prompt install (let DSH install it)

Paste this prompt into any DSH session and the agent installs it for you:

> Install the dsh-file-trace plugin (DSH file trace: records and reviews model file reads/writes/edits with diffs):
> 1. Run `dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:omdsh-dev/dsh-file-trace#v0.1.2'` (the first run may fail because pnpm 11 blocks node-pty build scripts)
> 2. Under `~/.dsh/profiles/web`, run `pnpm approve-builds --all` (approve the build scripts)
> 3. Re-run the install command from step 1
> 4. Append the `- insert` plugin row (id: dsh-file-trace, name: '@dsh-external/dsh-file-trace') to `~/.dsh/profiles/web/cordis.patch.yml`, then remind me to hard-refresh the browser (Ctrl/Cmd+Shift+R)
> On errors, first check the known limitations in the README at https://github.com/omdsh-dev/dsh-file-trace.

## Version compatibility

| Plugin version | DSH version | Notes |
| --- | --- | --- |
| `v0.1.2` (default) | `dsh-v0.1.2-alpha.1` | First version; source-built install, not published to npm. Typecheck, 20 unit tests, and build all green. |

- Targets **`dsh-v0.1.2-alpha.1`** (GitHub tag, source-built install).
- This version's breaking Client rework (removal of `dsh-client-runtime`, Conversation view refactor) is adapted in-tree, with a self-diagnostic banner as a fallback.

## Usage

1. Click "File trace" in the session-header utilities.
2. The drawer lists operations grouped by file (newest first); select one:
   - **read** → numbered file content;
   - **write** → all-added (green +) or true del/add;
   - **edit** → ±3 context lines around the change, with "… N lines" folds above/below.
3. Long lines (>120 chars) toggle on click; "[… N lines]" runs expand/collapse on click.
4. Drag the handle above the diff pane to resize; Esc or the close button dismisses the drawer.

## Known limitations

- Covers only the loaded window's operations, matching the Chat view; paging fills in as it loads.
- The edit "full-file context" relies on an earlier in-window write/read of the **same file**; otherwise only the model-provided old_string/new_string snippet is shown.
- Line-level diff only; in-line (character-level) highlighting is not implemented yet.
- The zh/en bilingual consistency record lives in `README.i18n.yaml`.
