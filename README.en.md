# @dsh-external/dsh-file-trace

A DSH Web UI file-trace plugin: like Codex / Claude Code, it **records and reviews every file the model reads, writes, or edits**. A "File trace" button (with an operation-count badge) appears in the session-header utilities; clicking opens a right-side drawer that lists all operations grouped by file, and selecting one shows the numbered content or a **line-by-line diff**. Zero core changes — a pure browser-half plugin.

**English** | [简体中文](./README.md)

## Features

- **Operation recording**: extracts the model's file reads / writes / edits, with running, error, timestamp, and payload-size markers.
- **Read view**: shows the real file content with **its real line numbers** (the DSH read-tool response envelope is stripped).
- **Write view**: a new-file write shows as **all-added (every line a green +)**; an overwrite shows the true del/add.
- **Edit view (hunk context folding)**: reconstructs the full file from an earlier in-window write/read, keeps **±3 lines of context** around the change, and folds unchanged large regions into a **"… N lines"** run (click to expand/collapse).
- **Long-line folding**: a single line over 120 chars folds to an ellipsis; click to expand/collapse.
- **Terminal-style diff**: monospace, line-number gutter, and **red (deleted) / green (added) / blue (modified)** font colors (backgrounds are only a softened tint for readability).
- **Resizable pane**: a drag handle above the diff pane lets you adjust its height.
- **Compatibility self-diagnosis**: the apply body probes the client APIs it needs; if absent it renders a remediation banner instead of crashing, pointing to an upgrade path.

## How it works

- Data is derived entirely from the session Chat view snapshot (`views.get('chat').legacy` tool-result nodes and runningCalls), **recursively walking subCalls of host tools such as run_code** — a pure derivation each render, no store, no listeners; refresh/paging stays aligned with the loaded window.
- The diff is a line-level LCS; a del-run followed by an add-run pairs as mod (rewritten).
- Registered into `conversation.session.header.utilities` (a session-scoped list slot via `ctx.slots.inject`).

## Install (profile mode)

```sh
# 1. Clone the repository (any of the three mirrors); build artifacts are in-tree
git clone https://github.com/omdsh-dev/dsh-file-trace.git
cd dsh-file-trace && pnpm install

# 2. Install into the web profile (equivalent to pnpm add under $DSH_HOME/profiles/web)
dsh plugin --profile web add link:/path/to/dsh-file-trace
#   or a pinned-tag git dependency:
#   dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:omdsh-dev/dsh-file-trace#v0.1.0'
```

Config line (`$DSH_HOME/profiles/web/cordis.patch.yml`, hot-reloaded, no restart needed):

```yaml
- insert:
    - id: dsh-file-trace
      name: '@dsh-external/dsh-file-trace'
```

> The plugin must be built (`pnpm run build` produces `lib/client.js`); cloned repos already ship the artifacts, but rebuild after editing source.

## Version compatibility

| Plugin version | DSH version | Notes |
| --- | --- | --- |
| `v0.1.0` (default) | `dsh-v0.1.2-alpha.1` | First version; source-built install, not published to npm. Typecheck, 20 unit tests, and build all green. |

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
