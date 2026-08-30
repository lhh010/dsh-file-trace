window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-file-trace",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/file-ops.ts
		/** Tool names mapped to each op kind; unknown names are ignored. */
		const READ_TOOLS = /* @__PURE__ */ new Set([
			"read",
			"view",
			"see"
		]);
		const WRITE_TOOLS = /* @__PURE__ */ new Set(["write", "create"]);
		const EDIT_TOOLS = /* @__PURE__ */ new Set([
			"edit",
			"str_replace",
			"str-replace-editor",
			"multi-edit"
		]);
		/** Classify one tool name; undefined when the tool touches no file. */
		function kindOf(name) {
			if (READ_TOOLS.has(name)) return "read";
			if (WRITE_TOOLS.has(name)) return "write";
			if (EDIT_TOOLS.has(name)) return "edit";
		}
		/**
		* Parse one raw tool-call arguments JSON body defensively: the payload is
		* model-emitted wire data, so every field is checked before use.
		*/
		function parseArgs(argsRaw) {
			try {
				const parsed = JSON.parse(argsRaw);
				if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
				return parsed;
			} catch {
				return {};
			}
		}
		/** Extract the path field common to every file tool's arguments. */
		function pathOf(args) {
			for (const key of [
				"file_path",
				"path",
				"filePath"
			]) {
				const value = args[key];
				if (typeof value === "string" && value.length > 0) return value;
			}
		}
		/** Extract one settled tool-result node when it touches a file. */
		function opOfResult(node) {
			if (node.call === null) return void 0;
			const kind = kindOf(node.call.name);
			if (kind === void 0) return void 0;
			const args = parseArgs(node.call.argsRaw);
			const path = pathOf(args);
			if (path === void 0) return void 0;
			const base = {
				callId: node.callId,
				kind,
				path,
				time: node.callTime ?? node.time,
				running: false,
				isError: node.isError
			};
			if (kind === "edit") {
				const oldString = args.old_string;
				const newString = args.new_string;
				return typeof oldString === "string" && typeof newString === "string" ? {
					...base,
					edit: {
						oldString,
						newString
					}
				} : base;
			}
			if (kind === "write") {
				const fromArgs = args.content;
				const fromResult = node.content.map((block) => "text" in block && typeof block.text === "string" ? block.text : "").join("");
				const content = typeof fromArgs === "string" && fromArgs.length > 0 ? fromArgs : fromResult;
				return content.length > 0 ? {
					...base,
					content
				} : base;
			}
			if (kind === "read") {
				const text = node.content.map((block) => "text" in block && typeof block.text === "string" ? block.text : "").join("");
				return text.length > 0 ? {
					...base,
					read: text
				} : base;
			}
			return base;
		}
		/** Extract one in-flight running call when it touches a file. */
		function opOfRunning(call) {
			const kind = kindOf(call.name);
			if (kind === void 0) return void 0;
			const path = pathOf(parseArgs(call.argsRaw));
			if (path === void 0) return void 0;
			return {
				callId: call.callId,
				kind,
				path,
				time: call.time,
				running: true,
				isError: false
			};
		}
		/**
		* All file operations in the loaded window, newest first. Running calls come
		* first (they are the live edge), settled results follow by time descending.
		* @param nodes - the Chat view's legacy node slice.
		* @param runningCalls - the Chat view's legacy in-flight calls.
		* @returns the ordered operation list.
		*/
		function extractFileOps(nodes, runningCalls) {
			const ops = [];
			for (const call of runningCalls) collectFromBlocks([call], ops);
			for (const node of nodes) {
				if (node.kind !== "tool-result") continue;
				collectFromBlocks([node], ops);
			}
			ops.sort((a, b) => b.time - a.time);
			return ops;
		}
		/** Recursively collect file operations from a block list (parent or descendant). */
		function collectFromBlocks(blocks, out) {
			for (const block of blocks) {
				const op = "call" in block ? opOfResult(block) : opOfRunning(block);
				if (op !== void 0) out.push(op);
				if (block.subCalls.length > 0) collectFromBlocks(block.subCalls, out);
			}
		}
		/**
		* Group operations by path, newest op first per file, files ordered by their
		* most recent operation.
		* @param ops - the flat operation list.
		* @returns file path to its operations (newest first within each file).
		*/
		function groupByFile(ops) {
			const groups = /* @__PURE__ */ new Map();
			for (const op of ops) {
				const list = groups.get(op.path) ?? [];
				list.push(op);
				groups.set(op.path, list);
			}
			const ordered = [...groups.entries()].sort((a, b) => b[1][0].time - a[1][0].time);
			return new Map(ordered);
		}
		/**
		* The last content known for a path before the given operation, synthesized
		* from earlier ops in the same window: a read's result carries the content,
		* an earlier write's payload is authoritative, and an edit implies its old
		* side. Best effort — a write with no known prior content diffs against
		* nothing (all-added).
		* @param ops - the flat operation list.
		* @param path - the file path to reconstruct.
		* @param before - the operation whose prior content is wanted.
		* @returns the best-known prior content, or undefined.
		*/
		function knownContentBefore(ops, path, before) {
			const ofFile = ops.filter((op) => op.path === path && op.time <= before.time && op !== before);
			for (let i = ofFile.length - 1; i >= 0; i -= 1) {
				const op = ofFile[i];
				if (op.kind === "write" && op.content !== void 0) return op.content;
				if (op.kind === "edit" && op.edit !== void 0 && i === ofFile.length - 1) return op.edit.oldString;
			}
		}
		/**
		* Parse a DSH read result into file lines with their real line numbers.
		* Drops the <content> envelope and "(Showing lines ...)" note; recovers the
		* "<n>: " prefix as the line number, falling back to sequential counting when
		* a line has no prefix.
		* @param raw - the read tool result text.
		* @returns ordered file lines.
		*/
		function parseReadLines(raw) {
			const contentMatch = raw.match(/<content>([\s\S]*?)<\/content>/);
			const body = contentMatch ? contentMatch[1] : raw;
			const result = [];
			let fallback = 1;
			for (const line of body.split("\n")) {
				if (/^\s*\(Showing lines .*\)\s*$/.test(line)) continue;
				if (line.length === 0) continue;
				const match = line.match(/^\s*(\d+):\s?(.*)$/);
				if (match !== null) {
					result.push({
						line: Number(match[1]),
						text: match[2] ?? ""
					});
					fallback = Number(match[1]) + 1;
				} else {
					result.push({
						line: fallback,
						text: line
					});
					fallback += 1;
				}
			}
			return result;
		}
		//#endregion
		//#region src/client/compat.ts
		/**
		* Graceful-compatibility helper: instead of throwing when the running DSH
		* client API no longer matches what this plugin needs, render a fixed-position
		* remediation banner and degrade. Pure DOM (appended to document.body), so it
		* works regardless of which slots/services the host still provides.
		*/
		/** Escape one text value for interpolation into the banner's innerHTML. */
		function escapeHtml(value) {
			return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
		}
		/** Fixed-position banner styling; injected once the first banner mounts. */
		const BANNER_CSS = [
			"position:fixed",
			"z-index:2147483000",
			"right:12px",
			"bottom:12px",
			"max-width:min(380px,calc(100vw - 24px))",
			"background:#1e2430",
			"color:#e6ebf2",
			"border:1px solid #f0a52a",
			"border-radius:10px",
			"padding:12px 14px",
			"font:13px/1.6 system-ui,Segoe UI,sans-serif",
			"box-shadow:0 8px 24px rgba(0,0,0,.35)"
		].join(";");
		/** One remediation banner; duplicates by id are dropped, click dismisses. */
		function renderCompatBanner(id, pluginName, cause, steps) {
			if (typeof document === "undefined") return;
			if (document.querySelector(`[data-dsh-compat-banner="${id}"]`) !== null) return;
			const el = document.createElement("div");
			el.setAttribute("data-dsh-compat-banner", id);
			el.setAttribute("role", "alert");
			el.setAttribute("style", BANNER_CSS);
			const list = steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
			el.innerHTML = [
				`<div style="font-weight:600;margin-bottom:4px">${escapeHtml(pluginName)} 与当前 DSH 不兼容</div>`,
				`<div style="margin-bottom:6px">原因：${escapeHtml(cause)}</div>`,
				`<div style="margin-bottom:4px">解决：</div>`,
				`<ol style="margin:0;padding-left:18px">${list}</ol>`,
				`<div style="margin-top:8px;color:#9aa4b2">点击关闭 · 更新后刷新页面即可</div>`
			].join("");
			el.addEventListener("click", () => {
				el.remove();
			});
			document.body.appendChild(el);
		}
		/** Fail-closed feature check: every required capability must be present. */
		function requireCapabilities(checks) {
			const missing = [];
			for (const [label, value] of checks) if (value === void 0 || value === null) missing.push(label);
			return missing;
		}
		/** Wrapper: run a plugin body, and on any missing capability or thrown error
		* render the remediation banner instead of crashing. */
		function applyWithCompat(pluginName, cause, steps, checks, body) {
			const missing = requireCapabilities(checks);
			if (missing.length > 0) {
				renderCompatBanner(pluginName, pluginName, `${cause}(缺失：${missing.join("、")})`, steps);
				return;
			}
			try {
				body();
			} catch (error) {
				renderCompatBanner(pluginName, pluginName, `${cause}(错误：${String(error?.message ?? error)})`, steps);
			}
		}
		//#endregion
		//#region src/client/update-check.ts
		/**
		* Client-side version check + click-to-update for the file-trace panel.
		* Queries the canonical public mirror's tags on GitHub (CORS-enabled,
		* unauthenticated), compares with the running version, and offers a
		* one-click update through the host endpoint — falling back to filling the
		* composer with the update prompt when the endpoint is unavailable.
		*/
		/** The running plugin version (from package.json at build time). */
		const PLUGIN_VERSION = "0.1.3";
		/** The canonical public mirror the check queries and the update installs from. */
		const MIRROR = "lhh010/dsh-file-trace";
		/** Compare two semver strings (v-prefixed); >0 when a is newer. */
		function compareSemver(a, b) {
			const parse = (v) => {
				const parts = v.replace(/^v/, "").split(".").map((x) => Number(x) || 0);
				while (parts.length < 3) parts.push(0);
				return parts;
			};
			const pa = parse(a);
			const pb = parse(b);
			const [b0, b1, b2] = parse(b);
			if (pa[0] !== pb[0]) return pa[0] - pb[0];
			if (pa[1] !== pb[1]) return pa[1] - pb[1];
			return pa[2] - pb[2];
		}
		/**
		* Fetch the newest stable tag from the public mirror; undefined on failure.
		* @returns the latest vX.Y.Z tag name, or undefined when unreachable.
		*/
		async function fetchLatestTag() {
			try {
				const res = await fetch(`https://api.github.com/repos/${MIRROR}/tags?per_page=10`, { headers: { accept: "application/vnd.github+json" } });
				if (!res.ok) return void 0;
				const tags = await res.json();
				if (!Array.isArray(tags)) return void 0;
				const stable = tags.map((entry) => entry.name).filter((name) => typeof name === "string" && /^v\d+\.\d+\.\d+$/.test(name));
				if (stable.length === 0) return void 0;
				return stable.reduce((newest, tag) => compareSemver(tag, newest) > 0 ? tag : newest);
			} catch {
				return;
			}
		}
		/** The update prompt used by the composer fallback path. */
		function updatePrompt(tag) {
			return [
				`帮我更新 dsh-file-trace 插件到 ${tag}，步骤：`,
				`1. 执行 dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:lhh010/dsh-file-trace#${tag}'（首次可能被 pnpm 11 拦截构建脚本，则先在 ~/.dsh/profiles/web 执行 pnpm approve-builds --all）`,
				"2. 完成后提醒我硬刷新浏览器（Ctrl/Cmd+Shift+R）"
			].join("\n");
		}
		/**
		* Trigger the host-side install of the given tag (user-initiated click).
		* @param tag - the vX.Y.Z tag to install.
		* @returns whether the install succeeded, with tail detail text.
		*/
		async function runUpdate(tag) {
			try {
				const res = await fetch("/dsh-file-trace/update", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ tag })
				});
				const parsed = await res.json().catch(() => ({}));
				return {
					ok: res.ok && parsed.ok === true,
					detail: typeof parsed.output === "string" ? parsed.output : parsed.error ?? String(res.status)
				};
			} catch (error) {
				return {
					ok: false,
					detail: String(error?.message ?? error)
				};
			}
		}
		//#endregion
		//#region src/client/diff.ts
		/**
		* Longest-common-subsequence table over line equality.
		* @param oldLines - old side lines.
		* @param newLines - new side lines.
		* @returns the LCS length matrix (rows index oldLines, columns newLines).
		*/
		function lcsTable(oldLines, newLines) {
			const table = Array.from({ length: oldLines.length + 1 }, () => new Array(newLines.length + 1).fill(0));
			for (let i = oldLines.length - 1; i >= 0; i -= 1) for (let j = newLines.length - 1; j >= 0; j -= 1) table[i][j] = oldLines[i] === newLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
			return table;
		}
		/**
		* Line diff by LCS walk with rewrite pairing: the raw walk emits context/del/
		* add rows; a del-run immediately followed by an add-run marks the overlapping
		* min(len) rows on both sides as 'mod' so rewrites tint distinctly.
		* @param oldText - the previous content; empty string diffs against nothing.
		* @param newText - the next content.
		* @returns ordered diff rows, old-side deletions before new-side additions.
		*/
		function diffLines(oldText, newText) {
			const oldLines = oldText.length === 0 ? [] : oldText.split("\n");
			const newLines = newText.length === 0 ? [] : newText.split("\n");
			const table = lcsTable(oldLines, newLines);
			const raw = [];
			let i = 0;
			let j = 0;
			while (i < oldLines.length && j < newLines.length) if (oldLines[i] === newLines[j]) {
				raw.push({
					kind: "context",
					oldLine: i + 1,
					newLine: j + 1,
					text: oldLines[i]
				});
				i += 1;
				j += 1;
			} else if (table[i + 1][j] >= table[i][j + 1]) {
				raw.push({
					kind: "del",
					oldLine: i + 1,
					text: oldLines[i]
				});
				i += 1;
			} else {
				raw.push({
					kind: "add",
					newLine: j + 1,
					text: newLines[j]
				});
				j += 1;
			}
			while (i < oldLines.length) {
				raw.push({
					kind: "del",
					oldLine: i + 1,
					text: oldLines[i]
				});
				i += 1;
			}
			while (j < newLines.length) {
				raw.push({
					kind: "add",
					newLine: j + 1,
					text: newLines[j]
				});
				j += 1;
			}
			const rows = raw.slice();
			let k = 0;
			while (k < rows.length) {
				if (rows[k].kind !== "del") {
					k += 1;
					continue;
				}
				const delStart = k;
				while (k < rows.length && rows[k].kind === "del") k += 1;
				const addStart = k;
				while (k < rows.length && rows[k].kind === "add") k += 1;
				const pairs = Math.min(addStart - delStart, k - addStart);
				for (let p = 0; p < pairs; p += 1) {
					rows[delStart + p] = {
						...rows[delStart + p],
						kind: "mod"
					};
					rows[addStart + p] = {
						...rows[addStart + p],
						kind: "mod"
					};
				}
			}
			return rows;
		}
		/**
		* Group a line diff into hunks and folded context runs. Consecutive changes
		* whose gap fits within the context window merge into one hunk; unchanged
		* regions between hunks (and any surrounding the whole diff) become fold
		* segments that default collapsed. This yields the file-hunk presentation
		* familiar from terminal diffs (Claude Code / git hunk headers).
		* @param rows - the flat diff rows.
		* @param context - how many unchanged rows around a change stay visible.
		* @returns ordered segments (hunks and folds).
		*/
		function buildDiffSegments(rows, context = 3) {
			if (rows.length === 0) return [];
			const changeIndexes = rows.flatMap((row, index) => row.kind === "context" ? [] : [index]);
			if (changeIndexes.length === 0) return [{
				kind: "fold",
				rows: [...rows],
				oldStart: 1,
				oldEnd: rows.length,
				newStart: 1,
				newEnd: rows.length
			}];
			const hunks = [];
			for (const ci of changeIndexes) {
				const start = Math.max(0, ci - context);
				const end = Math.min(rows.length - 1, ci + context);
				const last = hunks[hunks.length - 1];
				if (last !== void 0 && start <= last.end + 1) last.end = Math.max(last.end, end);
				else hunks.push({
					start,
					end
				});
			}
			const segments = [];
			let cursor = 0;
			for (const hunk of hunks) {
				if (hunk.start > cursor) {
					const foldRows = rows.slice(cursor, hunk.start);
					segments.push({
						kind: "fold",
						rows: foldRows,
						oldStart: firstOldLine(foldRows) ?? (foldRows.length === 0 ? cursor + 1 : cursor + 1),
						oldEnd: lastOldLine(foldRows) ?? 0,
						newStart: firstNewLine(foldRows) ?? (foldRows.length === 0 ? cursor + 1 : cursor + 1),
						newEnd: lastNewLine(foldRows) ?? 0
					});
				}
				segments.push({
					kind: "hunk",
					rows: rows.slice(hunk.start, hunk.end + 1)
				});
				cursor = hunk.end + 1;
			}
			if (cursor < rows.length) {
				const foldRows = rows.slice(cursor);
				segments.push({
					kind: "fold",
					rows: foldRows,
					oldStart: firstOldLine(foldRows) ?? cursor + 1,
					oldEnd: lastOldLine(foldRows) ?? 0,
					newStart: firstNewLine(foldRows) ?? cursor + 1,
					newEnd: lastNewLine(foldRows) ?? 0
				});
			}
			return segments;
		}
		function firstOldLine(rows) {
			for (const row of rows) if (row.oldLine !== void 0) return row.oldLine;
		}
		function lastOldLine(rows) {
			for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].oldLine !== void 0) return rows[i].oldLine;
		}
		function firstNewLine(rows) {
			for (const row of rows) if (row.newLine !== void 0) return row.newLine;
		}
		function lastNewLine(rows) {
			for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].newLine !== void 0) return rows[i].newLine;
		}
		/** Char-diff table guard: above this, inline highlighting is skipped. */
		const INLINE_MAX = 2e3;
		/**
		* Character-level diff between two line texts, used to highlight the exact
		* changed substring inside a "mod" (rewritten) line. Long lines degrade to a
		* single all-changed segment. Pure, no React/DOM.
		* @param oldText - the old line.
		* @param newText - the new line.
		* @returns per-side segments marking changed runs.
		*/
		function diffInline(oldText, newText) {
			const m = oldText.length;
			const n = newText.length;
			if (m > INLINE_MAX || n > INLINE_MAX) return {
				old: [{
					text: oldText,
					changed: oldText !== newText
				}],
				next: [{
					text: newText,
					changed: oldText !== newText
				}]
			};
			const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
			for (let i = m - 1; i >= 0; i -= 1) for (let j = n - 1; j >= 0; j -= 1) dp[i][j] = oldText[i] === newText[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
			const oldSegs = [];
			const nextSegs = [];
			let i = 0;
			let j = 0;
			let oBuf = "";
			let nBuf = "";
			let oChanged = false;
			let nChanged = false;
			const flushOld = () => {
				if (oBuf.length > 0) {
					oldSegs.push({
						text: oBuf,
						changed: oChanged
					});
					oBuf = "";
					oChanged = false;
				}
			};
			const flushNext = () => {
				if (nBuf.length > 0) {
					nextSegs.push({
						text: nBuf,
						changed: nChanged
					});
					nBuf = "";
					nChanged = false;
				}
			};
			while (i < m && j < n) if (oldText[i] === newText[j]) {
				flushOld();
				flushNext();
				oldSegs.push({
					text: oldText[i],
					changed: false
				});
				nextSegs.push({
					text: newText[j],
					changed: false
				});
				i += 1;
				j += 1;
			} else if (dp[i + 1][j] >= dp[i][j + 1]) {
				oBuf += oldText[i];
				oChanged = true;
				flushNext();
				i += 1;
			} else {
				nBuf += newText[j];
				nChanged = true;
				flushOld();
				j += 1;
			}
			flushOld();
			flushNext();
			while (i < m) {
				oBuf += oldText[i];
				oChanged = true;
				i += 1;
				flushOld();
			}
			while (j < n) {
				nBuf += newText[j];
				nChanged = true;
				j += 1;
				flushNext();
			}
			return {
				old: oldSegs,
				next: nextSegs
			};
		}
		/** Human byte count for the panel meta row. */
		function formatBytes(bytes) {
			if (bytes < 1024) return `${String(bytes)} B`;
			if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / 1048576).toFixed(1)} MB`;
		}
		//#endregion
		//#region \0dsh-css:E:\deepseek-harness\dsh-file-trace\src\client\FileTrace.module.css.mjs
		const css = ".GHGoAa_trigger{border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:8px;align-items:center;gap:6px;padding:0 8px;font-size:12px;line-height:24px;display:inline-flex}.GHGoAa_crashHint{z-index:2147483000;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-state-error-primary);max-width:340px;color:var(--dsw-alias-label-primary);border-radius:10px;padding:10px 12px;font:13px/1.6 system-ui,Segoe UI,sans-serif;position:fixed;bottom:12px;left:12px}.GHGoAa_trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.GHGoAa_updateBadge{border:1px solid var(--dsw-alias-state-business-primary);color:var(--dsh-alias-state-business-primary);font:inherit;cursor:pointer;background:0 0;border-radius:8px;flex:none;padding:0 8px;font-size:11px;line-height:20px}.GHGoAa_updateBadge:hover{background:var(--dsw-alias-state-business-tertiary)}.GHGoAa_updateBadge[data-updating=true]{opacity:.6;cursor:wait}.GHGoAa_updateMsg{text-overflow:ellipsis;white-space:nowrap;max-width:220px;color:var(--dsw-alias-label-caption);flex:none;font-size:11px;overflow:hidden}.GHGoAa_badge{background:var(--dsw-alias-state-business-primary);min-width:18px;height:18px;color:var(--dsw-alias-bg-base);border-radius:9px;justify-content:center;align-items:center;padding:0 5px;font-size:11px;display:inline-flex}.GHGoAa_drawer{z-index:1200;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv3);border-radius:10px;flex-direction:column;font-size:13px;display:flex;position:fixed;overflow:hidden}.GHGoAa_drawerHead{border-bottom:1px solid var(--dsw-alias-border-l1);cursor:move;user-select:none;touch-action:none;align-items:center;gap:10px;padding:10px 14px;display:flex}.GHGoAa_resizeW{cursor:ew-resize;z-index:2;touch-action:none;width:6px;position:absolute;top:0;bottom:0;left:0}.GHGoAa_resizeH{cursor:ns-resize;z-index:2;touch-action:none;height:6px;position:absolute;bottom:0;left:0;right:0}.GHGoAa_resizeW:hover,.GHGoAa_resizeH:hover{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, transparent)}.GHGoAa_drawerTitle{color:var(--dsw-alias-label-primary);font-weight:600}.GHGoAa_drawerMeta{color:var(--dsw-alias-label-caption);flex:1}.GHGoAa_close{color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:7px;padding:2px 8px}.GHGoAa_close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.GHGoAa_drawerBody{flex:1;min-height:0;padding:8px 10px;overflow-y:auto}.GHGoAa_empty{color:var(--dsw-alias-label-caption);text-align:center;padding:24px 8px}.GHGoAa_fileGroup{margin-bottom:10px}.GHGoAa_filePath{color:var(--dsw-alias-label-secondary);font-family:var(--dsw-mono-font,ui-monospace, monospace);word-break:break-all;padding:2px 4px;font-size:12px;display:block}.GHGoAa_opRow{width:100%;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;text-align:left;background:0 0;border:0;border-radius:8px;align-items:center;gap:8px;padding:4px 6px;font-size:12px;display:flex}.GHGoAa_opRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.GHGoAa_opKind{background:var(--dsw-alias-interactive-bg-muted,var(--dsw-alias-border-l1));color:var(--dsw-alias-label-secondary);border-radius:6px;padding:0 6px;font-size:11px;line-height:18px}.GHGoAa_opKind[data-kind=write]{color:var(--dsw-alias-state-success-primary)}.GHGoAa_opKind[data-kind=edit]{color:var(--dsw-alias-state-business-primary)}.GHGoAa_opTime{color:var(--dsw-alias-label-caption);font-size:11px}.GHGoAa_opFlag{color:var(--dsw-alias-state-business-primary);font-size:11px}.GHGoAa_opFlagError{color:var(--dsw-alias-state-error-primary);font-size:11px}.GHGoAa_opSize{color:var(--dsw-alias-label-caption);margin-left:auto;font-size:11px}.GHGoAa_diffPane{border-top:1px solid var(--dsw-alias-border-l1);flex-direction:column;flex:none;min-height:0;display:flex}.GHGoAa_diffHead{border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;gap:8px;padding:6px 14px;display:flex}.GHGoAa_diffPath{font-family:var(--dsw-mono-font,ui-monospace, monospace);word-break:break-all;color:var(--dsw-alias-label-primary);flex:1;font-size:12px}.GHGoAa_diffKind[data-kind=write]{color:var(--dsw-alias-state-success-primary)}.GHGoAa_diffKind[data-kind=edit]{color:var(--dsw-alias-state-business-primary)}.GHGoAa_dragHandle{cursor:ns-resize;background:var(--dsw-alias-bg-base);flex:none;height:8px;position:relative}.GHGoAa_dragHandle:after{content:\"\";background:var(--dsw-alias-border-l1);border-radius:1px;width:48px;height:2px;position:absolute;top:3px;left:calc(50% - 24px)}.GHGoAa_dragHandle:hover:after{background:var(--dsw-alias-state-business-primary)}.GHGoAa_diffRows,.GHGoAa_readContent{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.GHGoAa_diffRows{min-height:0;font-family:var(--dsw-mono-font,ui-monospace, monospace);flex:1;padding:4px 0 10px;font-size:12px;overflow-y:auto}.GHGoAa_diffRow{cursor:default;align-items:flex-start;gap:6px;padding:0 10px;line-height:20px;display:flex}.GHGoAa_diffRow[data-folded=true]{cursor:pointer}.GHGoAa_lineNo{width:3em;color:var(--dsw-alias-label-caption);text-align:right;user-select:none;flex:none}.GHGoAa_sign{text-align:center;user-select:none;flex:none;width:1em;font-weight:700}.GHGoAa_diffRow[data-kind=del] .GHGoAa_sign,.GHGoAa_diffRow[data-kind=del] .GHGoAa_text{color:var(--dsw-alias-state-error-primary)}.GHGoAa_diffRow[data-kind=add] .GHGoAa_sign,.GHGoAa_diffRow[data-kind=add] .GHGoAa_text{color:var(--dsw-alias-state-success-primary)}.GHGoAa_diffRow[data-kind=mod] .GHGoAa_sign,.GHGoAa_diffRow[data-kind=mod] .GHGoAa_text{color:var(--dsw-alias-state-business-primary)}.GHGoAa_diffRow[data-kind=context] .GHGoAa_sign,.GHGoAa_diffRow[data-kind=context] .GHGoAa_text,.GHGoAa_diffRow[data-kind=context]{color:var(--dsw-alias-label-secondary)}.GHGoAa_diffRow .GHGoAa_text{white-space:pre-wrap;word-break:break-word;flex:1;min-width:0}.GHGoAa_diffRow[data-folded=true] .GHGoAa_text{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.GHGoAa_inlineChange{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 26%, transparent);border-radius:3px;padding:0 1px}.GHGoAa_readContent{white-space:pre-wrap;word-break:break-word;min-height:0;font-family:var(--dsw-mono-font,ui-monospace, monospace);flex:1;margin:0;padding:6px 0 10px;font-size:12px;line-height:1.55;overflow:auto}.GHGoAa_readRow{color:var(--dsw-alias-label-primary);gap:6px;padding:0 10px;line-height:20px;display:flex}.GHGoAa_readError{color:var(--dsh-alias-state-error-primary);border-left:3px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-base);white-space:pre-wrap;word-break:break-word;border-radius:0 8px 8px 0;margin:6px 10px;padding:8px 12px}.GHGoAa_priorUnknown{color:var(--dsw-alias-label-caption);background:var(--dsw-alias-bg-base);padding:4px 14px;font-size:11px}.GHGoAa_foldRow{cursor:pointer;padding:0 10px}.GHGoAa_foldRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.GHGoAa_foldMarker{color:var(--dsw-alias-label-caption);background:var(--dsw-alias-interactive-bg-muted,var(--dsw-alias-border-l1));border-radius:6px;margin:2px 0;padding:2px 8px;font-style:italic;display:inline-block}.GHGoAa_foldRow[data-expanded=true]{cursor:default}.GHGoAa_foldRow[data-expanded=true] .GHGoAa_foldMarker{display:none}";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"@dsh-external/dsh-file-trace/FileTrace.module.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dsh-external/dsh-file-trace";
			tag.dataset.pluginCss = "@dsh-external/dsh-file-trace/FileTrace.module.css";
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var FileTrace_module_css_default = {
			"diffHead": "GHGoAa_diffHead",
			"readContent": "GHGoAa_readContent",
			"inlineChange": "GHGoAa_inlineChange",
			"opFlagError": "GHGoAa_opFlagError",
			"diffKind": "GHGoAa_diffKind",
			"diffRows": "GHGoAa_diffRows",
			"badge": "GHGoAa_badge",
			"diffPane": "GHGoAa_diffPane",
			"trigger": "GHGoAa_trigger",
			"drawerMeta": "GHGoAa_drawerMeta",
			"filePath": "GHGoAa_filePath",
			"crashHint": "GHGoAa_crashHint",
			"diffRow": "GHGoAa_diffRow",
			"updateBadge": "GHGoAa_updateBadge",
			"diffPath": "GHGoAa_diffPath",
			"drawer": "GHGoAa_drawer",
			"drawerTitle": "GHGoAa_drawerTitle",
			"drawerBody": "GHGoAa_drawerBody",
			"fileGroup": "GHGoAa_fileGroup",
			"foldMarker": "GHGoAa_foldMarker",
			"empty": "GHGoAa_empty",
			"opKind": "GHGoAa_opKind",
			"lineNo": "GHGoAa_lineNo",
			"dragHandle": "GHGoAa_dragHandle",
			"priorUnknown": "GHGoAa_priorUnknown",
			"drawerHead": "GHGoAa_drawerHead",
			"opRow": "GHGoAa_opRow",
			"readRow": "GHGoAa_readRow",
			"text": "GHGoAa_text",
			"resizeH": "GHGoAa_resizeH",
			"readError": "GHGoAa_readError",
			"updateMsg": "GHGoAa_updateMsg",
			"opFlag": "GHGoAa_opFlag",
			"opTime": "GHGoAa_opTime",
			"opSize": "GHGoAa_opSize",
			"foldRow": "GHGoAa_foldRow",
			"resizeW": "GHGoAa_resizeW",
			"close": "GHGoAa_close",
			"sign": "GHGoAa_sign"
		};
		//#endregion
		//#region src/client/FileTraceButton.tsx
		/**
		* FileTraceButton: the session-header utilities trigger. Derives the file
		* operation list live from the Chat view snapshot (pure derivation each
		* render — no store, no listener), shows a count badge, and on click opens
		* a self-contained fixed-position drawer listing every touched file with a
		* line-diff view (del red / add green / mod blue via --dsw state tokens).
		*/
		/** Renders the remediation banner once when the drawer subtree throws. */
		var DrawerErrorBoundary = class extends react.Component {
			state = { failed: false };
			static getDerivedStateFromError() {
				return { failed: true };
			}
			componentDidCatch(error) {
				renderCompatBanner("dsh-file-trace", "@dsh-external/dsh-file-trace", `渲染出错：${String(error?.message ?? error)}`, ["请将插件更新到适配当前 DSH 的版本；", "或在插件目录执行 pnpm run build 后刷新页面。"]);
			}
			render() {
				if (this.state.failed) return null;
				return this.props.children;
			}
		};
		/** Long diff lines fold to one ellipsized row; the threshold is the char count. */
		const FOLD_THRESHOLD = 120;
		/** Diff material for one operation, computed at open time.
		* For an edit the model's payload is only the changed snippet, so a hunched
		* diff needs the file's prior full content: when known (from an earlier
		* write/read in the window) apply the replacement to reconstruct the new full
		* content and diff whole files; otherwise fall back to the snippet itself. */
		function diffOf(op, prior) {
			if (op.kind === "read") return [];
			if (op.kind === "edit" && op.edit !== void 0) {
				const { oldString, newString } = op.edit;
				if (prior !== void 0 && prior.includes(oldString)) return diffLines(prior, prior.replace(oldString, newString));
				return diffLines(oldString, newString);
			}
			if (op.kind === "write") {
				const content = op.content ?? "";
				return diffLines((prior !== void 0 && prior !== content ? prior : void 0) ?? "", content);
			}
			return [];
		}
		/** The header trigger button plus its drawer. */
		function FileTraceButton({ useConversation, t }) {
			const ops = useConversation((conversation) => {
				const chat = conversation.views.get("chat");
				return extractFileOps(chat?.legacy.nodes ?? [], chat?.legacy.runningCalls ?? []);
			});
			const groups = (0, react.useMemo)(() => groupByFile(ops), [ops]);
			const [open, setOpen] = (0, react.useState)(false);
			const [latestTag, setLatestTag] = (0, react.useState)(void 0);
			const [updating, setUpdating] = (0, react.useState)(false);
			const [updateMsg, setUpdateMsg] = (0, react.useState)(null);
			const [selected, setSelected] = (0, react.useState)(null);
			const [expandedLines, setExpandedLines] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [expandedFolds, setExpandedFolds] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [diffHeight, setDiffHeight] = (0, react.useState)(340);
			(0, react.useRef)(null);
			const LS_POS = "dsh-file-trace:pos";
			const LS_SIZE = "dsh-file-trace:size";
			const [winPos, setWinPos] = (0, react.useState)(() => {
				try {
					const saved = window.localStorage.getItem(LS_POS);
					if (saved !== null) return JSON.parse(saved);
				} catch {}
				return {
					x: Math.max(16, window.innerWidth - 576),
					y: Math.max(16, Math.round(window.innerHeight * .12))
				};
			});
			const [winSize, setWinSize] = (0, react.useState)(() => {
				try {
					const saved = window.localStorage.getItem(LS_SIZE);
					if (saved !== null) return JSON.parse(saved);
				} catch {}
				return {
					w: Math.min(560, window.innerWidth - 32),
					h: Math.min(720, window.innerHeight - 64)
				};
			});
			const posRef = (0, react.useRef)(winPos);
			posRef.current = winPos;
			const sizeRef = (0, react.useRef)(winSize);
			sizeRef.current = winSize;
			const saveWin = (key, value) => {
				try {
					window.localStorage.setItem(key, JSON.stringify(value));
				} catch {}
			};
			/** Right-edge docking: released near the right edge, the window snaps into
			* a full-height right sidebar; dragging the header undocks it again. */
			const LS_DOCK = "dsh-file-trace:dock";
			const SNAP_PX = 24;
			const [docked, setDocked] = (0, react.useState)(() => {
				try {
					return window.localStorage.getItem(LS_DOCK) === "right";
				} catch {
					return false;
				}
			});
			const dockedRef = (0, react.useRef)(docked);
			dockedRef.current = docked;
			/** Apply the docked-right geometry: flush to the right edge, full height. */
			const applyDock = () => {
				const w = sizeRef.current.w;
				setWinPos({
					x: window.innerWidth - w,
					y: 0
				});
				setWinSize((prev) => ({
					...prev,
					h: window.innerHeight
				}));
			};
			/** Drag the floating window by its header; clamped to the viewport.
			* Dragging undocks a docked window; releasing near the right edge docks it
			* into a full-height right sidebar. */
			const startWinDrag = (e) => {
				if (e.target.closest("button") !== null) return;
				e.preventDefault();
				if (dockedRef.current) {
					setDocked(false);
					saveWin(LS_DOCK, "free");
				}
				const startX = e.clientX;
				const startY = e.clientY;
				const start = posRef.current;
				const size = sizeRef.current;
				const onMove = (ev) => {
					const x = Math.min(Math.max(start.x + ev.clientX - startX, 8), Math.max(8, window.innerWidth - size.w - 8));
					const y = Math.min(Math.max(start.y + ev.clientY - startY, 8), Math.max(8, window.innerHeight - 64));
					setWinPos({
						x,
						y
					});
				};
				const onUp = (up) => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					if (up.clientX >= window.innerWidth - SNAP_PX) {
						setDocked(true);
						saveWin(LS_DOCK, "right");
						applyDock();
					}
					saveWin(LS_POS, posRef.current);
					saveWin(LS_SIZE, sizeRef.current);
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
			};
			/** Resize the floating window from the left edge (right edge anchored). */
			const startWinResizeW = (e) => {
				e.preventDefault();
				const start = sizeRef.current;
				const anchorRight = posRef.current.x + start.w;
				const onMove = (ev) => {
					const w = Math.min(Math.max(anchorRight - ev.clientX, 360), Math.min(window.innerWidth - 16, anchorRight - 8));
					setWinSize((prev) => ({
						...prev,
						w
					}));
					setWinPos((prev) => ({
						...prev,
						x: anchorRight - w
					}));
				};
				const onUp = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					saveWin(LS_SIZE, sizeRef.current);
					saveWin(LS_POS, posRef.current);
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
			};
			/** Resize the floating window from the bottom edge (top edge anchored). */
			const startWinResizeH = (e) => {
				e.preventDefault();
				const startY = e.clientY;
				const startH = sizeRef.current.h;
				const onMove = (ev) => {
					const h = Math.min(Math.max(startH + ev.clientY - startY, 200), window.innerHeight - posRef.current.y - 8);
					setWinSize((prev) => ({
						...prev,
						h
					}));
				};
				const onUp = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					saveWin(LS_SIZE, sizeRef.current);
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
			};
			const onHandleDown = (e) => {
				e.preventDefault();
				const startY = e.clientY;
				const startH = diffHeight;
				const onMove = (ev) => {
					setDiffHeight(Math.min(Math.max(startH + (startY - ev.clientY), 140), Math.round(window.innerHeight * .85)));
				};
				const onUp = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
			};
			(0, react.useEffect)(() => {
				const id = "dsh-file-trace-dock-style";
				const existing = document.getElementById(id);
				if (docked && open) {
					const el = existing ?? document.createElement("style");
					el.id = id;
					el.textContent = `body { margin-right: ${String(winSize.w)}px !important; }`;
					if (existing === null) document.head.appendChild(el);
					return () => {
						el.remove();
					};
				}
				if (existing !== null) existing.remove();
			}, [
				docked,
				open,
				winSize.w
			]);
			(0, react.useEffect)(() => {
				if (dockedRef.current) applyDock();
			}, []);
			(0, react.useEffect)(() => {
				const onResize = () => {
					if (dockedRef.current) applyDock();
				};
				window.addEventListener("resize", onResize);
				return () => {
					window.removeEventListener("resize", onResize);
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!open || latestTag !== void 0) return;
				fetchLatestTag().then((tag) => {
					if (tag !== void 0) setLatestTag(tag);
				});
			}, [open, latestTag]);
			const newerTag = latestTag !== void 0 && compareSemver(latestTag, PLUGIN_VERSION) > 0 ? latestTag : void 0;
			/** One-click update: host endpoint first; on failure, copy the prompt. */
			const onUpdateClick = () => {
				if (newerTag === void 0 || updating) return;
				setUpdating(true);
				setUpdateMsg(null);
				runUpdate(newerTag).then((result) => {
					setUpdating(false);
					if (result.ok) {
						setUpdateMsg(`已更新到 ${newerTag}，请硬刷新浏览器（Ctrl/Cmd+Shift+R）`);
						return;
					}
					navigator.clipboard?.writeText(updatePrompt(newerTag)).then(() => {
						setUpdateMsg(`自动更新失败（${result.detail.slice(0, 80)}）；已复制更新提示词到剪贴板，粘贴发送即可`);
					}).catch(() => {
						setUpdateMsg(`自动更新失败；请手动执行：dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:lhh010/dsh-file-trace#${newerTag}'`);
					});
				});
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				const onKey = (e) => {
					if (e.key === "Escape") setOpen(false);
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, [open]);
			const count = ops.length;
			const selectedOp = selected?.op;
			const diffRows = (0, react.useMemo)(() => selectedOp === void 0 ? [] : diffOf(selectedOp, knownContentBefore(ops, selected?.path ?? "", selectedOp)), [
				selectedOp,
				selected?.path,
				ops
			]);
			const segments = (0, react.useMemo)(() => buildDiffSegments(diffRows), [diffRows]);
			const inlineMap = (0, react.useMemo)(() => {
				const map = /* @__PURE__ */ new Map();
				let i = 0;
				while (i < diffRows.length) {
					if (diffRows[i].kind !== "mod") {
						i += 1;
						continue;
					}
					let j = i;
					while (j < diffRows.length && diffRows[j].kind === "mod") j += 1;
					const block = diffRows.slice(i, j);
					const k = Math.floor(block.length / 2);
					for (let p = 0; p < k; p += 1) {
						const delRow = block[p];
						const addRow = block[p + k];
						const r = diffInline(delRow.text, addRow.text);
						map.set(`${String(delRow.oldLine ?? "")}|${String(delRow.newLine ?? "")}`, r);
						map.set(`${String(addRow.oldLine ?? "")}|${String(addRow.newLine ?? "")}`, r);
					}
					i = j;
				}
				return map;
			}, [diffRows]);
			(0, react.useEffect)(() => {
				setExpandedLines(/* @__PURE__ */ new Set());
				setExpandedFolds(/* @__PURE__ */ new Set());
			}, [selectedOp]);
			const renderDiffRow = (row, rowKey) => {
				const isLong = row.text.length > FOLD_THRESHOLD;
				const isFolded = isLong && !expandedLines.has(rowKey);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: FileTrace_module_css_default.diffRow,
					"data-kind": row.kind,
					"data-folded": isFolded ? "true" : void 0,
					onClick: isLong ? () => {
						setExpandedLines((prev) => {
							const next = new Set(prev);
							if (next.has(rowKey)) next.delete(rowKey);
							else next.add(rowKey);
							return next;
						});
					} : void 0,
					title: isFolded ? row.text : void 0,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FileTrace_module_css_default.lineNo,
							children: row.oldLine !== void 0 ? String(row.oldLine) : ""
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FileTrace_module_css_default.lineNo,
							children: row.newLine !== void 0 ? String(row.newLine) : ""
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FileTrace_module_css_default.sign,
							"aria-label": t(`diff.${row.kind}`),
							children: row.kind === "del" ? "-" : row.kind === "add" ? "+" : row.kind === "mod" ? "~" : " "
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: FileTrace_module_css_default.text,
							"data-folded": isFolded ? "true" : void 0,
							children: [row.kind === "mod" && (() => {
								const inline = inlineMap.get(`${String(row.oldLine ?? "")}|${String(row.newLine ?? "")}`);
								if (inline === void 0) return row.text;
								return (row.oldLine !== void 0 ? inline.old : inline.next).map((seg, segIndex) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: seg.changed ? FileTrace_module_css_default.inlineChange : void 0,
									children: seg.text
								}, String(segIndex)));
							})(), row.kind !== "mod" && row.text]
						})
					]
				}, rowKey);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DrawerErrorBoundary, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: FileTrace_module_css_default.trigger,
				"data-file-trace-trigger": true,
				title: t("open"),
				"aria-label": `${t("title")} (${String(count)})`,
				onClick: () => {
					setOpen((prev) => !prev);
					setSelected(null);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: FileTrace_module_css_default.triggerLabel,
					children: t("title")
				}), count > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: FileTrace_module_css_default.badge,
					children: String(count)
				})]
			}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FileTrace_module_css_default.drawer,
				"data-file-trace-drawer": true,
				"data-dock": docked ? "right" : void 0,
				role: "dialog",
				"aria-label": t("title"),
				style: {
					left: winPos.x,
					top: winPos.y,
					width: winSize.w,
					height: winSize.h
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: FileTrace_module_css_default.resizeW,
						"data-ft-resize-w": true,
						onPointerDown: startWinResizeW,
						role: "separator",
						"aria-orientation": "vertical"
					}),
					docked ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: FileTrace_module_css_default.resizeH,
						"data-ft-resize-h": true,
						onPointerDown: startWinResizeH,
						role: "separator",
						"aria-orientation": "horizontal"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: FileTrace_module_css_default.drawerHead,
						onPointerDown: startWinDrag,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileTrace_module_css_default.drawerTitle,
								children: t("title")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: FileTrace_module_css_default.drawerMeta,
								children: [
									String(groups.size),
									" ",
									t("files"),
									" · ",
									String(count),
									" ops"
								]
							}),
							newerTag !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: FileTrace_module_css_default.updateBadge,
								"data-updating": updating ? "true" : void 0,
								onClick: onUpdateClick,
								title: `一键更新到 ${newerTag}（点击触发；失败则复制提示词）`,
								children: updating ? "更新中…" : `⟳ 更新到 ${newerTag}`
							}),
							updateMsg !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileTrace_module_css_default.updateMsg,
								children: updateMsg
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: FileTrace_module_css_default.close,
								onClick: () => {
									setOpen(false);
								},
								children: t("close")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: FileTrace_module_css_default.drawerBody,
						children: [count === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: FileTrace_module_css_default.empty,
							children: t("empty")
						}), [...groups.entries()].map(([path, fileOps]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: FileTrace_module_css_default.fileGroup,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FileTrace_module_css_default.filePath,
								title: path,
								children: path
							}), fileOps.map((op) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: FileTrace_module_css_default.opRow,
								"data-op-kind": op.kind,
								"data-op-error": op.isError ? "true" : void 0,
								onClick: () => {
									setSelected({
										path,
										op
									});
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FileTrace_module_css_default.opKind,
										"data-kind": op.kind,
										children: t(`ops.${op.kind}`)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FileTrace_module_css_default.opTime,
										children: new Date(op.time).toLocaleTimeString()
									}),
									op.running && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FileTrace_module_css_default.opFlag,
										children: t("running")
									}),
									op.isError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FileTrace_module_css_default.opFlagError,
										children: t("error")
									}),
									op.kind !== "read" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FileTrace_module_css_default.opSize,
										children: formatBytes(new Blob([op.edit?.newString ?? op.content ?? ""]).size)
									})
								]
							}, op.callId))]
						}, path))]
					}),
					selected !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: FileTrace_module_css_default.diffPane,
						"data-file-trace-diff": true,
						style: { height: diffHeight },
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FileTrace_module_css_default.dragHandle,
								onPointerDown: onHandleDown,
								role: "separator",
								"aria-orientation": "horizontal",
								"aria-label": "drag to resize"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: FileTrace_module_css_default.diffHead,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FileTrace_module_css_default.diffPath,
										children: selected.path
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FileTrace_module_css_default.diffKind,
										"data-kind": selected.op.kind,
										children: t(`ops.${selected.op.kind}`)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: FileTrace_module_css_default.close,
										onClick: () => {
											setSelected(null);
										},
										children: "×"
									})
								]
							}),
							selected.op.kind === "read" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FileTrace_module_css_default.readContent,
								"data-file-trace-read": true,
								"data-error": selected.op.isError ? "true" : void 0,
								children: selected.op.isError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: FileTrace_module_css_default.readError,
									role: "alert",
									children: selected.op.read ?? t("error")
								}) : (selected.op.read === void 0 ? [] : parseReadLines(selected.op.read)).map((line) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: FileTrace_module_css_default.readRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FileTrace_module_css_default.lineNo,
										children: String(line.line)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FileTrace_module_css_default.text,
										children: line.text
									})]
								}, String(line.line)))
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: FileTrace_module_css_default.diffRows,
								children: [selected.op.kind === "write" && knownContentBefore(ops, selected.path, selected.op) === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: FileTrace_module_css_default.priorUnknown,
									children: t("diff.priorUnknown")
								}), segments.map((segment, segIndex) => {
									if (segment.kind === "fold") {
										const shouldFold = segment.rows.length >= 3;
										const isExpanded = expandedFolds.has(segIndex);
										if (!shouldFold) return segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`));
										return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: FileTrace_module_css_default.foldRow,
											"data-expanded": isExpanded ? "true" : void 0,
											onClick: () => {
												setExpandedFolds((prev) => {
													const next = new Set(prev);
													if (next.has(segIndex)) next.delete(segIndex);
													else next.add(segIndex);
													return next;
												});
											},
											children: isExpanded ? segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: FileTrace_module_css_default.foldMarker,
												title: `${t("diff.context")} ${segment.oldStart}–${segment.oldEnd} · ${segment.newStart}–${segment.newEnd}`,
												children: t("diff.fold", { count: String(segment.rows.length) })
											})
										}, `fold-${String(segIndex)}`);
									}
									return segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`));
								})]
							})
						]
					})
				]
			})] }) });
		}
		//#endregion
		//#region src/client/locales.ts
		const zh = {
			title: "文件追踪",
			open: "查看本会话文件变更",
			close: "关闭",
			empty: "本会话窗口内还没有文件操作",
			files: "个文件",
			"ops.read": "读取",
			"ops.write": "写入",
			"ops.edit": "编辑",
			running: "执行中",
			error: "出错",
			"diff.old": "旧",
			"diff.new": "新",
			"diff.context": "上下文",
			"diff.del": "删除",
			"diff.add": "新增",
			"diff.mod": "修改",
			"diff.priorUnknown": "（变更前的内容不在当前窗口，显示为全新增）",
			"diff.fold": "{count} 行…点击展开",
			"meta.bytes": "{bytes}"
		};
		const en = {
			title: "File trace",
			open: "Review file changes in this session",
			close: "Close",
			empty: "No file operations in the loaded window yet",
			files: "files",
			"ops.read": "Read",
			"ops.write": "Write",
			"ops.edit": "Edit",
			running: "running",
			error: "error",
			"diff.old": "old",
			"diff.new": "new",
			"diff.context": "context",
			"diff.del": "deleted",
			"diff.add": "added",
			"diff.mod": "modified",
			"diff.priorUnknown": "(prior content outside the loaded window; shown all-added)",
			"diff.fold": "{count} lines…click to expand",
			"meta.bytes": "{bytes}"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "fileTrace";
		/**
		* Required services (cordis fiber inject): the slot registry for the header
		* utilities contribution and the locale service for the dictionaries.
		*/
		const inject = ["slots", "locale"];
		/**
		* Client plugin body: register the `fileTrace` dictionaries and the header
		* trigger behind the graceful-compatibility guard.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			applyWithCompat("@dsh-external/dsh-file-trace", "当前 DSH 客户端 API 与插件不匹配", [
				"将 DSH 升级到已适配的版本（dsh-v0.1.2-alpha.1，源码构建安装）。",
				"或将插件更新到适配当前 DSH 的版本（仓库最新 tag）。",
				"如仍显示，请在插件目录执行 pnpm run build 后刷新页面。"
			], [
				["slots.inject", ctx?.slots?.inject],
				["slots.register", ctx?.slots?.register],
				["locale.register", ctx?.locale?.register]
			], () => {
				ctx.effect(() => ctx.locale.register(NS, {
					zh,
					en
				}), "file-trace: dictionaries");
				ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
					name: "conversation.session.header.utilities",
					id: "file-trace",
					order: 10,
					locale: NS
				}, FileTraceButton));
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
