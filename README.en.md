# @dsh-external/dsh-file-trace

A DSH Web UI file-trace plugin: like Codex / Claude Code, it **records and reviews every file the model reads, writes, or edits**. A "File trace" button (with an operation-count badge) appears in the session-header utilities; clicking opens a floating window that lists all operations grouped by file, and selecting one shows the numbered content or a **line-by-line diff**. Zero core changes — a pure browser-half plugin.

**English** | [简体中文](./README.md)

> **Pick the plugin version that matches your DSH** (a mismatch crashes: common symptom `useConversation is not a function`)
> - DSH **0.1.1-rc.2**: this plugin targets **alpha.x** only; no version for rc.2
> - DSH **0.1.2-alpha.1 / alpha.2 / alpha.3**: install the **new** version (the default command below)
## Install (profile mode)

```sh
# Option 1: pinned-tag git dependency (public mirror, recommended; github:lhh010/dsh-file-trace also works)
dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:lhh010/dsh-file-trace#v0.2.4'

# Option 2: local link (development; cloned repos ship build artifacts, rebuild with pnpm run build after edits)
git clone https://github.com/lhh010/dsh-file-trace.git
cd dsh-file-trace && pnpm install
dsh plugin --profile web add link:/path/to/dsh-file-trace
```

Config line (`$DSH_HOME/profiles/web/cordis.patch.yml`, hot-reloaded, no restart needed):

```yaml
- insert:
    - id: dsh-file-trace
      name: '@dsh-external/dsh-file-trace'
```

> **Install tips**: pnpm 11 may block node-pty build scripts on first install — run `pnpm approve-builds --all` under `~/.dsh/profiles/web` and re-run the install; then **hard-refresh the browser** (Ctrl/Cmd+Shift+R).

### Prompt install (let DSH install it)

Paste this prompt into any DSH session and the agent installs it for you:

> Install the dsh-file-trace plugin (DSH file trace: records and reviews model file reads/writes/edits with diffs):
> 1. Run `dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:lhh010/dsh-file-trace#v0.2.4'` (the first run may fail because pnpm 11 blocks node-pty build scripts)
> 2. Under `~/.dsh/profiles/web`, run `pnpm approve-builds --all` (approve the build scripts)
> 3. Re-run the install command from step 1
> 4. Append the `- insert` plugin row (id: dsh-file-trace, name: '@dsh-external/dsh-file-trace') to `~/.dsh/profiles/web/cordis.patch.yml`, then remind me to hard-refresh the browser (Ctrl/Cmd+Shift+R)
> On errors, first check the known limitations in the README at <https://github.com/lhh010/dsh-file-trace>.

## Features

- **Operation recording**: extracts the model's file reads / writes / edits with running, error, timestamp, and payload-size markers (recursively covering subCalls of host tools such as run_code).
- **Read view**: shows the real file content with **its real line numbers** (the DSH read-tool envelope is stripped).
- **Markdown reading mode + Mermaid**: operations on `.md / .markdown / .mdx` files show a Reading/Raw toggle in the pane header (available for read, write, and edit alike); reading mode renders the full document in **Obsidian style** — headings, tables (with alignment), thematic breaks, bold/italic/bold-italic, strikethrough, `==highlight==`, inline code, code fences, blockquotes, ordered/unordered lists and task checkboxes, links, and `[[wiki links]]`; images render by URL, while local-path images and non-image attachments show a unified file chip with the file name; YAML frontmatter renders as a code block. Edits reconstruct the resulting full document from the in-window prior content when known.
- **Mermaid diagram rendering (lazy + sanitized + zoom)**: ```mermaid fences in reading mode lazy-load the mermaid chunk from the host `/dsh-file-trace/resources` route (single-file bundle) and render as diagrams; beyond `securityLevel: strict` + `htmlLabels: false`, the emitted SVG passes a **zero-dependency whitelist sanitizer** (foreignObject/script/event attributes/all links stripped) before innerHTML; **click a diagram for the fullscreen zoom modal** (wheel zoom, drag pan, ±/0 keys, Esc or overlay-click close); import or render failure falls back to the plain code block.
- **Unified error display**: opening a failed read / write / edit shows the real error text from the result (a red error block) instead of a fabricated diff.
- **Syntax highlighting**: detects common languages by extension (C/C++, Java, C#, JS/TS incl. mjs/cjs/mts/cts, Python, Go, Rust, shell, cmd/batch, PowerShell, JSON/JSONC/JSON5/YAML/TOML/INI, SQL, CSS/SCSS/Less, HTML/XML/SVG/Vue, GraphQL, …) and colors **keywords / strings / numbers / types / functions / comments / preprocessor directives** in the read view and diff rows; on modified lines the intra-line change tint stacks on top.
- **Write view**: a new-file write shows as **all-added (every line a green +)**; an overwrite shows the true del/add.
- **Edit view (hunk context folding)**: reconstructs the full file from an earlier in-window write/read, keeps **±3 lines of context** around the change, and folds unchanged large regions (**only runs of ≥3 lines**; ≤2-line runs stay visible) into a "… N lines" run (click to expand/collapse).
- **Long-line folding**: a single line over 120 chars folds to an ellipsis; click to expand/collapse.
- **Terminal-style diff**: monospace, line-number gutter, and **red (deleted) / green (added) / blue (modified)** font colors (backgrounds are only a softened tint for readability).
- **Ctrl+wheel font sizing**: the op-list area and the file-content pane (diff/read views) size independently (Ctrl + mouse wheel, each persisted to localStorage); clamped to 9–28px with a "minimum/maximum font size reached" toast at the bounds.
- **Floating window (draggable / resizable / right-edge docking)**: drag the header to move, drag the left/bottom edges to resize (position and size persist in localStorage); **release the drag near the right screen edge to snap it into a full-height right sidebar while the main conversation shifts left with no overlap — drag the header again to undock**; a separate handle above the diff pane adjusts the list/diff split.
- **Compatibility self-diagnosis**: the apply body probes the client APIs it needs; if absent it renders a remediation banner instead of crashing. A render-error boundary likewise surfaces the fix hint if the component throws.

## How it works

- Data is derived entirely from the session Chat view snapshot (`views.get('chat').legacy` tool-result nodes and runningCalls) — a pure derivation each render, no store, no listeners; refresh/paging stays aligned with the loaded window.
- The diff is a line-level LCS; a del-run followed by an add-run pairs as mod (rewritten).
- Registered into `conversation.session.header.utilities` (a session-scoped list slot via `ctx.slots.inject`).

## Version compatibility

| Plugin version | DSH version | Notes |
| --- | --- | --- |
| `v0.2.4` (default) | `dsh-v0.1.2-alpha.1`–`alpha.3` | Mermaid render hardening (htmlLabels:false + SVG whitelist sanitizer) + click-to-zoom modal |
| `v0.2.3` | `dsh-v0.1.2-alpha.1`–`alpha.3` | Lazy mermaid rendering (code-block fallback); new host chunk-resource route |
| `v0.2.2` | `dsh-v0.1.2-alpha.1`–`alpha.3` | Highlight expansion (mjs/cjs/mts/cts, CSS/SCSS/Less, HTML/XML/SVG/Vue, GraphQL, JSONC/JSON5) + Ctrl+wheel per-area font sizing (9–28px with bound toasts) |
| `v0.2.0` | `dsh-v0.1.2-alpha.1`–`alpha.3` | Markdown reading mode (Obsidian-style rendering, toggle on read/write/edit) |
| `v0.1.8` | `dsh-v0.1.2-alpha.1`–`alpha.3` | Update-endpoint auth (x-dsh-plugin-update header + same-origin) and hostChanged detection |
| `v0.1.7` | `dsh-v0.1.2-alpha.1` | Syntax highlighting (multi-line block comments included); unified real-error display; fold-expansion alignment fix; version tracks the tag | 
| `v0.1.6` | `dsh-v0.1.2-alpha.1` | Host-same-origin version check; scroll position memory | 
| `v0.1.4` | `dsh-v0.1.2-alpha.1` | Auto version check + click-to-update |
| `v0.1.3` | `dsh-v0.1.2-alpha.1` | Right-edge docking into a sidebar with main-conversation avoidance; typecheck, 20 unit tests, build all green |
| `v0.1.2` | `dsh-v0.1.2-alpha.1` | Floating window (drag / resize / persistence) |
| `v0.1.1` | `dsh-v0.1.2-alpha.1` | Hunk fold threshold ≥3 lines; red error read view; render-error boundary |
| `v0.1.0` | `dsh-v0.1.2-alpha.1` | First version; source-built install, not published to npm |

- Targets **`dsh-v0.1.2-alpha.1`** (GitHub tag, source-built install).
- This version's breaking Client rework (removal of `dsh-client-runtime`, Conversation view refactor) is adapted in-tree, with a self-diagnostic banner as a fallback.

## Usage

1. Click "File trace" in the session-header utilities.
2. The window lists operations grouped by file (newest first); select one (`.md` files offer a Reading toggle that renders the document; Raw switches back):
   - **read** → numbered file content (errors render as a red block);
   - **write** → all-added (green +) or true del/add;
   - **edit** → ±3 context lines around the change, with "… N lines" folds above/below.
3. Long lines (>120 chars) toggle on click; "… N lines" runs expand/collapse on click.
4. Drag the header to move the window; **release near the right screen edge to dock it as a right sidebar** (the main conversation shifts left automatically), drag again to undock; drag the left/bottom edges to resize.
5. Esc or the close button dismisses the window.

## Known limitations

- Covers only the loaded window's operations, matching the Chat view; paging fills in as it loads.
- The edit "full-file context" relies on an earlier in-window write/read of the **same file**; otherwise only the model-provided old_string/new_string snippet is shown.
- Line-level diff plus intra-line (character-level) highlighting; syntax highlighting is a lightweight regex tokenizer (no syntax tree) with multi-line block-comment state threaded in line order, so complex constructs may be imprecise.
- The zh/en bilingual consistency record lives in `README.i18n.yaml`.