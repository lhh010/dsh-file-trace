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
		/** Join a result's text blocks into one string. */
		function joinText(content) {
			return content.map((block) => {
				if (!("text" in block)) return "";
				const text = block.text;
				return typeof text === "string" ? text : "";
			}).join("");
		}
		/** Extract one settled tool-result node when it touches a file. */
		function opOfResult(node) {
			if (node.call === null) return void 0;
			const kind = kindOf(node.call.name);
			if (kind === void 0) return void 0;
			const args = parseArgs(node.call.argsRaw);
			const path = pathOf(args);
			if (path === void 0) return void 0;
			const errorText = node.isError ? joinText(node.content) : void 0;
			const base = {
				callId: node.callId,
				kind,
				path,
				time: node.callTime ?? node.time,
				running: false,
				isError: node.isError,
				...errorText !== void 0 && errorText.length > 0 ? { errorText } : {}
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
				const fromResult = joinText(node.content);
				const content = typeof fromArgs === "string" && fromArgs.length > 0 ? fromArgs : fromResult;
				return content.length > 0 ? {
					...base,
					content
				} : base;
			}
			if (kind === "read") {
				const text = joinText(node.content);
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
		* Strip the DSH read-tool response envelope from a read result so the panel
		* shows only the file content: drop the <path>/<type>/<content> wrapper, the
		* "(Showing lines ...)" note, and the per-line "<n>: " number prefixes. Falls
		* back to the raw text when no <content> section is present.
		*/
		function parseReadContent(raw) {
			const contentMatch = raw.match(/<content>([\s\S]*?)<\/content>/);
			return (contentMatch ? contentMatch[1] : raw).split("\n").filter((line) => !/^\s*\(Showing lines .*\)\s*$/.test(line)).map((line) => line.replace(/^\s*\d+:\s/, "")).join("\n").replace(/\n+$/, "");
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
		const PLUGIN_VERSION = "0.2.3";
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
		async function latestFromTags() {
			try {
				const res = await fetch(`https://api.github.com/repos/${MIRROR}/tags?per_page=10`, {
					headers: { accept: "application/vnd.github+json" },
					signal: AbortSignal.timeout(8e3)
				});
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
		/** Latest tag from the raw package.json version (CORS-friendly alternate). */
		async function latestFromRaw() {
			try {
				const res = await fetch(`https://raw.githubusercontent.com/${MIRROR}/main/package.json`, { signal: AbortSignal.timeout(8e3) });
				if (!res.ok) return void 0;
				const version = (await res.json()).version;
				return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) ? `v${version}` : void 0;
			} catch {
				return;
			}
		}
		/** Write-only host endpoint: same-origin so the browser is never subject to
		* GitHub CORS; falls back to the GitHub sources when the host half is absent. */
		async function latestFromHost() {
			try {
				const res = await fetch("/dsh-file-trace/latest", {
					method: "GET",
					signal: AbortSignal.timeout(9e3)
				});
				if (!res.ok) return void 0;
				const latest = (await res.json()).latest;
				return typeof latest === "string" && /^v\d+\.\d+\.\d+$/.test(latest) ? latest : void 0;
			} catch {
				return;
			}
		}
		async function fetchLatestTag() {
			const [host, tags, raw] = await Promise.all([
				latestFromHost(),
				latestFromTags(),
				latestFromRaw()
			]);
			return host ?? tags ?? raw;
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
					headers: {
						"content-type": "application/json",
						"x-dsh-plugin-update": "click"
					},
					body: JSON.stringify({ tag }),
					signal: AbortSignal.timeout(13e4)
				});
				const parsed = await res.json().catch(() => ({}));
				return {
					ok: res.ok && parsed.ok === true,
					detail: typeof parsed.output === "string" ? parsed.output : parsed.error ?? String(res.status),
					link: parsed.link === true,
					...typeof parsed.recovery === "string" ? { recovery: parsed.recovery } : {},
					...parsed.hostChanged === true ? { hostChanged: true } : {}
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
		/**
		* Character-level diff between two line texts, used to highlight the exact
		* changed substring inside a "mod" (rewritten) line. Long lines degrade to a
		* single all-changed segment. Pure, no React/DOM.
		* @param oldText - the old line.
		* @param newText - the new line.
		* @returns per-side segments marking changed runs.
		*/
		/**
		* Intra-line diff by common prefix/suffix: the shared leading and trailing
		* characters stay unchanged, and only the differing middle is marked changed
		* on both sides. This never highlights identical characters and keeps a small
		* edit inside a long line immediately visible. Pure, no React/DOM.
		* @param oldText - the old line.
		* @param newText - the new line.
		* @returns per-side segments marking changed runs.
		*/
		function diffInline(oldText, newText) {
			const minLen = Math.min(oldText.length, newText.length);
			let prefix = 0;
			while (prefix < minLen && oldText[prefix] === newText[prefix]) prefix += 1;
			let suffix = 0;
			while (suffix < minLen - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix += 1;
			const oldMidStart = prefix;
			const oldMidEnd = oldText.length - suffix;
			const newMidStart = prefix;
			const newMidEnd = newText.length - suffix;
			const segments = (text, midStart, midEnd) => {
				const out = [];
				if (midStart > 0) out.push({
					text: text.slice(0, midStart),
					changed: false
				});
				const mid = text.slice(midStart, midEnd);
				if (mid.length > 0) out.push({
					text: mid,
					changed: true
				});
				if (midEnd < text.length) out.push({
					text: text.slice(midEnd),
					changed: false
				});
				return out;
			};
			return {
				old: segments(oldText, oldMidStart, oldMidEnd),
				next: segments(newText, newMidStart, newMidEnd)
			};
		}
		/**
		* Merge adjacent inline segments sharing the same changed flag, so rendering
		* wraps each run — not each character — in one span.
		* @param segments - the raw per-character-heavy inline segments.
		* @returns coalesced segments; identical text joined into runs.
		*/
		function coalesceInline(segments) {
			const out = [];
			for (const seg of segments) {
				const last = out[out.length - 1];
				if (last !== void 0 && last.changed === seg.changed) out[out.length - 1] = {
					text: last.text + seg.text,
					changed: seg.changed
				};
				else out.push(seg);
			}
			return out;
		}
		/** Human byte count for the panel meta row. */
		function formatBytes(bytes) {
			if (bytes < 1024) return `${String(bytes)} B`;
			if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / 1048576).toFixed(1)} MB`;
		}
		//#endregion
		//#region src/client/highlight.ts
		/** Token classes that imply their own color; `plain` inherits the row color. */
		const COLORED = /* @__PURE__ */ new Set([
			"comment",
			"string",
			"keyword",
			"number",
			"type",
			"function",
			"macro"
		]);
		const LETTER = /[A-Za-z_$]/u;
		const WORD = /[A-Za-z0-9_$]/u;
		const ANYWORD = {
			wordStart: LETTER,
			wordBody: WORD
		};
		const kw = (words) => new Set(words.split(/\s+/));
		const C_FAMILY = (words) => ({
			lineComments: ["//"],
			blockComment: ["/*", "*/"],
			strings: [
				"\"",
				"'",
				"`"
			],
			keywords: kw(words),
			constants: kw("true false null NULL nullptr TRUE FALSE"),
			macro: true,
			...ANYWORD
		});
		const HASH_FAMILY = (words, constants = "") => ({
			lineComments: ["#"],
			strings: ["\"", "'"],
			keywords: kw(words),
			constants: kw(constants.length > 0 ? constants : "True False None true false null"),
			macro: false,
			...ANYWORD
		});
		const CONFIG_LANG = {
			lineComments: ["#"],
			strings: ["\"", "'"],
			keywords: /* @__PURE__ */ new Set(),
			constants: /* @__PURE__ */ new Set(),
			macro: false,
			wordStart: LETTER,
			wordBody: WORD
		};
		/** SQL: '--' line comments plus '#', quoting with single quotes. */
		const SQL_LANG = {
			lineComments: ["--", "#"],
			strings: ["'"],
			keywords: kw(`select from where insert into values update set delete create table drop alter add column
    primary key foreign references index view join inner left right outer on as order by group having
    limit offset distinct union all and or not in exists between like is null asc desc count sum avg
    min max case when then else end begin commit rollback transaction default constraint unique`),
			constants: kw("true false null"),
			macro: false,
			...ANYWORD
		};
		/** Windows batch: 'REM'/'::' comments, '%' variable quoting. */
		const CMD_LANG = {
			lineComments: ["::"],
			strings: ["\""],
			keywords: kw(`rem if else for in do goto call exit echo set setlocal endlocal shift
    exist defined errorlevel not equ neq lss leq gtr geq nul con defined enabledelayedexpansion`),
			constants: /* @__PURE__ */ new Set(),
			macro: false,
			wordStart: LETTER,
			wordBody: WORD
		};
		/** PowerShell: '#' comments, quoted strings including here-string quotes. */
		const PS_LANG = {
			lineComments: ["#"],
			blockComment: ["<#", "#>"],
			strings: ["\"", "'"],
			keywords: kw(`function param begin process end if elseif else foreach for while do until switch
    try catch finally throw return break continue filter in workflow class enum interface
    dynamicparam data checkpoint systemlanguage default expand`),
			constants: kw("true false null"),
			macro: false,
			...ANYWORD
		};
		/** CSS family: block comments delimited by slash-star, hyphenated property words. */
		const CSS_LANG = {
			lineComments: [],
			blockComment: ["/*", "*/"],
			strings: ["\"", "'"],
			keywords: kw(`media import charset keyframes font-face supports page namespace layer scope container
    property value at-rule when and not only from to important
    background background-color background-image background-position background-size
    border border-radius border-color border-width border-style bottom box-shadow box-sizing
    color content cursor clip clip-path clear display direction
    flex flex-direction flex-wrap flex-flow flex-grow flex-shrink flex-basis
    font font-family font-size font-style font-weight float fill
    grid grid-area grid-template grid-template-columns grid-template-rows grid-gap gap
    height left letter-spacing line-height list-style margin margin-top margin-right
    margin-bottom margin-left max-height max-width min-height min-width opacity order
    outline overflow padding padding-top padding-right padding-bottom padding-left
    position pointer-events right rotate scale translate transform transform-origin
    text-align text-decoration text-transform top transition transition-property
    user-select vertical-align visibility white-space width word-break word-spacing z-index
    align-items align-content align-self justify-content justify-items justify-self
    aspect-ratio inset object-fit object-position resize scroll-behavior filter backdrop-filter
    animation animation-name animation-duration animation-timing-function animation-delay
    will-change
    html body p a div span li ul ol table tr td th form input button label select textarea img
    section header footer main nav article aside h1 h2 h3 h4 h5 h6 i b em strong small pre code
    inherit initial unset auto none fixed absolute relative sticky static flex block inline
    inline-block inline-flex grid hidden visible hidden bold normal inherit root var calc env`),
			constants: kw("true false"),
			macro: false,
			wordStart: /[A-Za-z-]/u,
			wordBody: /[A-Za-z0-9-]/u
		};
		/** Markup family (HTML/XML/SVG/Vue): <!-- --> comments plus common tags. */
		const MARKUP_LANG = {
			lineComments: [],
			blockComment: ["<!--", "-->"],
			strings: ["\"", "'"],
			keywords: kw(`html head body title meta link script style template slot
    div span p a img ul ol li table thead tbody tr th td form input button label select
    option textarea header footer main nav section article aside figure figcaption
    h1 h2 h3 h4 h5 h6 strong em b i u s small br hr pre code blockquote
    svg path circle rect line polyline polygon g defs use text symbol
    xml doctype class id href src type value name content charset async defer
    vue component props setup script-style export import v-if v-for v-bind v-on`),
			constants: /* @__PURE__ */ new Set(),
			macro: false,
			wordStart: LETTER,
			wordBody: WORD
		};
		/** Markdown: no tokenizer; the whole line stays plain. */
		const MD_LANG = {
			lineComments: [],
			strings: [],
			keywords: /* @__PURE__ */ new Set(),
			constants: /* @__PURE__ */ new Set(),
			macro: false,
			wordStart: LETTER,
			wordBody: WORD
		};
		/** JS keyword list, shared by js/jsx/mjs/cjs. */
		const JS_WORDS = `async await break case catch class const continue debugger default delete do else
  export extends false finally for from function get if implements import in instanceof interface
  let new null of return set static super switch this throw true try typeof undefined var void
  while with yield`;
		/** TS keyword list, shared by ts/tsx/mts/cts. */
		const TS_WORDS = `abstract any as asserts async await boolean break case catch class const constructor
  continue debugger declare default delete do else enum export extends false finally for from
  function get if implements import in infer instanceof interface is keyof let module namespace
  never new null number object of override private protected public readonly return satisfies set
  static string super switch symbol this throw true try type typeof undefined union unknown var
  void while with yield`;
		/** Extension → language id, mirroring the read tool's hint table. */
		const LANGS = {
			ts: C_FAMILY(TS_WORDS),
			tsx: C_FAMILY(`abstract any as asserts async await boolean break case catch class const constructor
    continue declare default delete do else enum export extends false finally for from function get
    if implements import in infer instanceof interface is keyof let module namespace never new null
    number object of override private protected public readonly return satisfies set static string
    super switch symbol this throw true try type typeof undefined union unknown var void while with
    yield`),
			js: C_FAMILY(JS_WORDS),
			jsx: C_FAMILY(`async await break case catch class const continue debugger default delete do else
    export extends false finally for from function get if implements import in instanceof interface
    let new null of return set static super switch this throw true try typeof undefined var void
    while with yield`),
			json: CONFIG_LANG,
			py: HASH_FAMILY(`and as assert async await break class continue def del elif else except finally
    for from global if import in is lambda nonlocal not or pass raise return try while with yield
    match case`, "True False None self cls NotImplemented __name__ __main__"),
			go: C_FAMILY(`break case chan const continue default defer else fallthrough for func go goto if
    import interface map package range return select struct switch type var nil iota make new len
    cap append copy close delete panic print println recover`),
			rs: C_FAMILY(`as async await break const continue crate dyn else enum extern false fn for if impl
    in let loop match mod move mut pub ref return self Self static struct super trait true type
    unsafe use where while`),
			java: C_FAMILY(`abstract assert boolean break byte case catch char class const continue default do
    double else enum extends final finally float for goto if implements import instanceof int
    interface long native new package private protected public return short static strictfp super
    switch synchronized this throw throws transient try void volatile while var record sealed
    permits yield`),
			c: C_FAMILY(`auto break case char const continue default do double else enum extern float for
    goto if inline int long register restrict return short signed sizeof static struct switch
    typedef union unsigned void volatile while _Bool _Complex _Atomic`),
			cpp: C_FAMILY(`alignas alignof and auto break case catch char class co_await co_return co_yield
    concept const consteval constexpr constinit const_cast continue decltype default delete
    do double dynamic_cast else enum explicit export extern false final float for friend goto if
    inline int long mutable namespace new noexcept not nullptr operator or override private
    protected public register reinterpret_cast requires return short signed sizeof static
    static_assert static_cast struct switch template this thread_local throw true try typedef
    typeid typename union unsigned using virtual void volatile wchar_t while`),
			cs: C_FAMILY(`abstract as async await base bool break byte case catch char checked class const
    continue decimal default delegate do double dynamic else enum event explicit extern false
    finally fixed float for foreach get goto if implicit in init int interface internal is lock
    long namespace new null not null forgiving object operator out override params partial
    private protected public readonly record ref return sbyte sealed set short sizeof stackalloc
    static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort
    using var virtual void volatile when where while with yield`),
			kt: C_FAMILY(`as break by catch class companion const constructor continue crossinline data do
    dynamic else enum external false final finally for fun get if import in infix init inline
    interface internal is lateinit lazy null object open operator out override package private
    protected public reified return sealed set super suspend tailrec this throw true try typealias
    val var vararg when where while`),
			swift: C_FAMILY(`actor as associatedtype async await break case catch class continue
    convenience default defer deinit didSet do dynamic else enum extension fallthrough false
    final for func get guard if import in indirect infix init inout internal is lazy let nil
    nonmutating open operator optional override postfix precedencegroup prefix private protocol
    public repeat required rethrows return self set some static struct subscript super switch
    throw throws true try typealias unowned var weak where while willSet`),
			php: C_FAMILY(`abstract and array as break callable case catch class clone const continue declare
    default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum
    extends final finally fn for foreach function global goto if implements include
    include_once instanceof insteadof interface isset list match namespace new or print private
    protected public readonly require require_once return static switch throw trait try unset use
    var while xor yield true false null int string bool float void mixed never self parent`),
			sh: HASH_FAMILY(`if then else elif fi for while until do done case esac function in select time
    coproc return break continue local export readonly declare typeset unset shift eval exec trap
    exit source alias set`, "true false"),
			bash: HASH_FAMILY(`if then else elif fi for while until do done case esac function in select time
    coproc return break continue local export readonly declare typeset unset shift eval exec trap
    exit source alias set`, "true false"),
			zsh: HASH_FAMILY(`if then else elif fi for while until do done case esac function in select time
    coproc return break continue local export readonly declare typeset unset shift eval exec trap
    exit source alias set`, "true false"),
			yaml: CONFIG_LANG,
			yml: CONFIG_LANG,
			toml: CONFIG_LANG,
			ini: CONFIG_LANG,
			sql: SQL_LANG,
			cmd: CMD_LANG,
			bat: CMD_LANG,
			ps1: PS_LANG,
			psm1: PS_LANG,
			psd1: PS_LANG,
			md: MD_LANG,
			markdown: MD_LANG,
			mdx: MD_LANG,
			mjs: C_FAMILY(JS_WORDS),
			cjs: C_FAMILY(JS_WORDS),
			mts: C_FAMILY(TS_WORDS),
			cts: C_FAMILY(TS_WORDS),
			jsonc: CONFIG_LANG,
			json5: CONFIG_LANG,
			html: MARKUP_LANG,
			htm: MARKUP_LANG,
			xml: MARKUP_LANG,
			svg: MARKUP_LANG,
			vue: MARKUP_LANG,
			css: CSS_LANG,
			scss: CSS_LANG,
			less: CSS_LANG,
			graphql: HASH_FAMILY("query mutation fragment on directive enum input interface scalar schema type implements"),
			gql: HASH_FAMILY("query mutation fragment on directive enum input interface scalar schema type implements"),
			lua: HASH_FAMILY(`and break do else elseif end false for function goto if in local nil not or
    repeat return then true until while`)
		};
		/**
		* Language id for a file path's extension (the read tool's mapping): the
		* lowercase extension without its dot; dotfiles and unknown extensions map to
		* undefined (plain text).
		* @param path - the op's file path exactly as recorded.
		* @returns the language id, or undefined for plain text.
		*/
		function langOfPath(path) {
			const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
			const dot = base.lastIndexOf(".");
			if (dot <= 0) return void 0;
			const ext = base.slice(dot + 1).toLowerCase();
			return Object.hasOwn(LANGS, ext) ? ext : void 0;
		}
		/** Scan one line, entering from (and reporting) block-comment state. */
		function scanLine(line, lang, inBlock = false) {
			if (line.length === 0) return {
				tokens: [],
				inBlock
			};
			const cfg = lang !== void 0 ? LANGS[lang] : void 0;
			if (cfg === void 0 || cfg.lineComments.length === 0 && cfg.keywords.size === 0) return {
				tokens: [{
					text: line,
					type: "plain"
				}],
				inBlock: false
			};
			let inComment = inBlock && cfg.blockComment !== void 0;
			const tokens = [];
			const push = (text, type) => {
				if (text.length === 0) return;
				const last = tokens[tokens.length - 1];
				if (last !== void 0 && last.type === type) tokens[tokens.length - 1] = {
					text: last.text + text,
					type
				};
				else tokens.push({
					text,
					type
				});
			};
			let i = 0;
			const atLineComment = () => {
				for (const lead of cfg.lineComments) if (line.startsWith(lead, i)) return lead;
			};
			const atBlockOpen = () => cfg.blockComment !== void 0 && line.startsWith(cfg.blockComment[0], i) ? cfg.blockComment[0] : void 0;
			const readString = () => {
				const quote = line[i];
				i += 1;
				while (i < line.length && line[i] !== quote) {
					if (line[i] === "\\") i += 1;
					i += 1;
				}
				i = Math.min(i + 1, line.length);
			};
			while (i < line.length) {
				if (inComment) {
					const closeIdx = cfg.blockComment !== void 0 ? line.indexOf(cfg.blockComment[1], i) : -1;
					if (closeIdx === -1) {
						push(line.slice(i), "comment");
						return {
							tokens,
							inBlock: true
						};
					}
					const end = closeIdx + (cfg.blockComment?.[1].length ?? 0);
					push(line.slice(i, end), "comment");
					i = end;
					inComment = false;
					continue;
				}
				const ch = line[i];
				const wsMatch = /\s/u.exec(line.slice(i));
				if (wsMatch !== null && wsMatch.index === 0) {
					push(ch, "plain");
					i += 1;
					continue;
				}
				if (atLineComment() !== void 0) {
					push(line.slice(i), "comment");
					break;
				}
				const blockOpen = atBlockOpen();
				if (blockOpen !== void 0 && cfg.blockComment !== void 0) {
					const close = line.indexOf(cfg.blockComment[1], i + blockOpen.length);
					const end = close === -1 ? line.length : close + cfg.blockComment[1].length;
					push(line.slice(i, end), "comment");
					i = end;
					inComment = close === -1;
					continue;
				}
				if (cfg.strings !== void 0 && cfg.strings.includes(ch)) {
					const start = i;
					readString();
					push(line.slice(start, i), "string");
					continue;
				}
				if (/[0-9]/u.test(ch)) {
					const m = /^(?:0[xXbo][0-9a-fA-F_]+|[0-9][0-9_]*(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?)/u.exec(line.slice(i));
					const len = m !== null ? m[0].length : 1;
					push(line.slice(i, i + len), "number");
					i += len;
					continue;
				}
				if (cfg.wordStart.test(ch)) {
					let j = i + 1;
					while (j < line.length && cfg.wordBody.test(line[j])) j += 1;
					const word = line.slice(i, j);
					if ((lang === "cmd" || lang === "bat") && word.toLowerCase() === "rem") {
						push(line.slice(i), "comment");
						break;
					}
					let k = j;
					while (k < line.length && (line[k] === " " || line[k] === "	")) k += 1;
					if (cfg.constants.has(word)) push(word, "keyword");
					else if (cfg.keywords.has(word)) push(word, "keyword");
					else if (line[k] === "(") push(word, "function");
					else if (/^[A-Z]/u.test(word) && word.length > 1) push(word, "type");
					else push(word, "plain");
					i = j;
					continue;
				}
				if (cfg.macro && ch === "#" && (i === 0 || /\s/u.test(line[i - 1]))) {
					let j = i + 1;
					while (j < line.length && cfg.wordBody.test(line[j])) j += 1;
					push(line.slice(i, j), "macro");
					i = j;
					continue;
				}
				push(ch, "plain");
				i += 1;
			}
			return {
				tokens,
				inBlock: inComment
			};
		}
		/** True when the language has multi-line block-comment delimiters. */
		function hasBlockComment(lang) {
			return lang !== void 0 && LANGS[lang]?.blockComment !== void 0;
		}
		/** Token classes worth wrapping in a span; plain runs join the parent text node. */
		function isColored(token) {
			return COLORED.has(token.type);
		}
		//#endregion
		//#region \0dsh-css:E:\deepseek-harness\dsh-file-trace\src\client\FileTrace.module.css.mjs
		const css = ".GHGoAa_trigger{border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:8px;align-items:center;gap:6px;padding:0 8px;font-size:12px;line-height:24px;display:inline-flex}.GHGoAa_crashHint{z-index:2147483000;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-state-error-primary);max-width:340px;color:var(--dsw-alias-label-primary);border-radius:10px;padding:10px 12px;font:13px/1.6 system-ui,Segoe UI,sans-serif;position:fixed;bottom:12px;left:12px}.GHGoAa_trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.GHGoAa_updateBadge{border:1px solid var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);font:inherit;cursor:pointer;background:0 0;border-radius:8px;flex:none;padding:0 8px;font-size:11px;line-height:20px}.GHGoAa_updateBadge:hover{background:var(--dsw-alias-state-business-tertiary)}.GHGoAa_updateBadge[data-updating=true]{opacity:.6;cursor:wait}.GHGoAa_updateDot{background:var(--dsw-alias-state-business-primary);min-width:16px;height:16px;color:var(--dsw-alias-bg-base);border-radius:50%;justify-content:center;align-items:center;font-size:11px;line-height:1;display:inline-flex}.GHGoAa_updateMsg{text-overflow:ellipsis;white-space:nowrap;max-width:220px;color:var(--dsw-alias-label-caption);flex:none;font-size:11px;overflow:hidden}.GHGoAa_badge{background:var(--dsw-alias-state-business-primary);min-width:18px;height:18px;color:var(--dsw-alias-bg-base);border-radius:9px;justify-content:center;align-items:center;padding:0 5px;font-size:11px;display:inline-flex}.GHGoAa_drawer{z-index:1200;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv3);border-radius:10px;flex-direction:column;font-size:13px;display:flex;position:fixed;overflow:hidden}.GHGoAa_drawerHead{border-bottom:1px solid var(--dsw-alias-border-l1);cursor:move;user-select:none;touch-action:none;align-items:center;gap:10px;padding:10px 14px;display:flex}.GHGoAa_resizeW{cursor:ew-resize;z-index:2;touch-action:none;width:6px;position:absolute;top:0;bottom:0;left:0}.GHGoAa_resizeT{cursor:ns-resize;z-index:2;touch-action:none;height:6px;position:absolute;top:0;left:0;right:0}.GHGoAa_resizeR{cursor:ew-resize;z-index:2;touch-action:none;width:6px;position:absolute;top:0;bottom:0;right:0}.GHGoAa_resizeH{cursor:ns-resize;z-index:2;touch-action:none;height:6px;position:absolute;bottom:0;left:0;right:0}.GHGoAa_resizeW:hover,.GHGoAa_resizeH:hover{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, transparent)}.GHGoAa_drawerTitle{color:var(--dsw-alias-label-primary);font-weight:600}.GHGoAa_drawerMeta{color:var(--dsw-alias-label-caption);flex:1}.GHGoAa_close{color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:7px;padding:2px 8px}.GHGoAa_close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.GHGoAa_drawerBody{flex:1;min-height:0;margin-right:12px;padding:8px 10px;overflow-y:auto}.GHGoAa_empty{color:var(--dsw-alias-label-caption);text-align:center;padding:24px 8px}.GHGoAa_fileGroup{margin-bottom:10px}.GHGoAa_filePath{color:var(--dsw-alias-label-secondary);font-family:var(--dsw-mono-font,ui-monospace, monospace);font-size:var(--ft-list-font,12px);word-break:break-all;padding:2px 4px;display:block}.GHGoAa_opRow{width:100%;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--ft-list-font,12px);cursor:pointer;text-align:left;background:0 0;border:0;border-radius:8px;align-items:center;gap:8px;padding:4px 6px;display:flex}.GHGoAa_opRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.GHGoAa_opKind{background:var(--dsw-alias-interactive-bg-muted,var(--dsw-alias-border-l1));color:var(--dsw-alias-label-secondary);border-radius:6px;padding:0 6px;font-size:11px;line-height:18px}.GHGoAa_opKind[data-kind=write]{color:var(--dsw-alias-state-success-primary)}.GHGoAa_opKind[data-kind=edit]{color:var(--dsw-alias-state-business-primary)}.GHGoAa_opTime{color:var(--dsw-alias-label-caption);font-size:11px}.GHGoAa_opFlag{color:var(--dsw-alias-state-business-primary);font-size:11px}.GHGoAa_opFlagError{color:var(--dsw-alias-state-error-primary);font-size:11px}.GHGoAa_opSize{color:var(--dsw-alias-label-caption);margin-left:auto;font-size:11px}.GHGoAa_diffPane{border-top:1px solid var(--dsw-alias-border-l1);flex-direction:column;flex:none;min-height:0;display:flex}.GHGoAa_diffHead{border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;gap:8px;padding:6px 14px;display:flex}.GHGoAa_diffPath{font-family:var(--dsw-mono-font,ui-monospace, monospace);word-break:break-all;color:var(--dsw-alias-label-primary);flex:1;font-size:12px}.GHGoAa_diffKind[data-kind=write]{color:var(--dsw-alias-state-success-primary)}.GHGoAa_diffKind[data-kind=edit]{color:var(--dsw-alias-state-business-primary)}.GHGoAa_dragHandle{cursor:ns-resize;background:var(--dsw-alias-bg-base);flex:none;height:8px;position:relative}.GHGoAa_dragHandle:after{content:\"\";background:var(--dsw-alias-border-l1);border-radius:1px;width:48px;height:2px;position:absolute;top:3px;left:calc(50% - 24px)}.GHGoAa_dragHandle:hover:after{background:var(--dsw-alias-state-business-primary)}.GHGoAa_diffRows,.GHGoAa_readContent{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.GHGoAa_diffRows{min-height:0;font-family:var(--dsw-mono-font,ui-monospace, monospace);font-size:var(--ft-pane-font,12px);flex:1;margin-right:12px;padding:4px 0 10px;overflow-y:auto}.GHGoAa_diffRow{cursor:default;align-items:flex-start;gap:6px;padding:0 10px;line-height:20px;display:flex}.GHGoAa_diffRow[data-folded=true]{cursor:pointer}.GHGoAa_lineNo{width:3em;color:var(--dsw-alias-label-caption);text-align:right;user-select:none;flex:none}.GHGoAa_sign{text-align:center;user-select:none;flex:none;width:1em;font-weight:700}.GHGoAa_diffRow[data-kind=del] .GHGoAa_sign,.GHGoAa_diffRow[data-kind=del] .GHGoAa_text{color:var(--dsw-alias-state-error-primary)}.GHGoAa_diffRow[data-kind=add] .GHGoAa_sign,.GHGoAa_diffRow[data-kind=add] .GHGoAa_text{color:var(--dsw-alias-state-success-primary)}.GHGoAa_diffRow[data-kind=mod] .GHGoAa_sign,.GHGoAa_diffRow[data-kind=mod] .GHGoAa_text{color:var(--dsw-alias-state-business-primary)}.GHGoAa_diffRow[data-kind=context] .GHGoAa_sign,.GHGoAa_diffRow[data-kind=context] .GHGoAa_text,.GHGoAa_diffRow[data-kind=context]{color:var(--dsw-alias-label-secondary)}.GHGoAa_diffRow .GHGoAa_text{white-space:pre-wrap;word-break:break-word;flex:1;min-width:0}.GHGoAa_diffRow[data-folded=true] .GHGoAa_text{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.GHGoAa_inlineChange{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 26%, transparent);border-radius:3px;padding:0 1px}.GHGoAa_tokComment{color:var(--dsw-alias-label-tertiary);font-style:italic}.GHGoAa_tokKeyword{color:color-mix(in oklab, var(--dsw-static-blue-450) 60%, var(--dsw-static-red-400))}.GHGoAa_tokString{color:color-mix(in oklab, var(--dsw-static-green-400) 48%, var(--dsw-static-blue-400))}.GHGoAa_tokType{color:color-mix(in oklab, var(--dsw-static-blue-300) 55%, var(--dsw-static-green-400))}.GHGoAa_tokNumber{color:var(--dsw-static-amber-400)}.GHGoAa_tokFunction{color:var(--dsw-static-amber-600)}.GHGoAa_tokMacro{color:color-mix(in oklab, var(--dsw-static-red-400) 55%, var(--dsw-static-blue-400))}.GHGoAa_readContent{white-space:pre-wrap;word-break:break-word;min-height:0;font-family:var(--dsw-mono-font,ui-monospace, monospace);font-size:var(--ft-pane-font,12px);flex:1;margin:0 12px 0 0;padding:6px 0 10px;line-height:1.55;overflow:auto}.GHGoAa_readRow{color:var(--dsw-alias-label-primary);gap:6px;padding:0 10px;line-height:20px;display:flex}.GHGoAa_readError{color:var(--dsw-alias-state-error-primary);border-left:3px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-base);white-space:pre-wrap;word-break:break-word;border-radius:0 8px 8px 0;margin:6px 10px;padding:8px 12px}.GHGoAa_drawerError{color:var(--dsw-alias-state-error-primary);padding:24px 14px;font:13px/1.6 system-ui,sans-serif}.GHGoAa_priorUnknown{color:var(--dsw-alias-label-caption);background:var(--dsw-alias-bg-base);padding:4px 14px;font-size:11px}.GHGoAa_foldRow{cursor:pointer;padding:0 10px}.GHGoAa_foldRow[data-expanded=true]{padding:0}.GHGoAa_foldRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.GHGoAa_foldMarker{color:var(--dsw-alias-label-caption);background:var(--dsw-alias-interactive-bg-muted,var(--dsw-alias-border-l1));border-radius:6px;margin:2px 0;padding:2px 8px;font-style:italic;display:inline-block}.GHGoAa_foldRow[data-expanded=true]{cursor:default}.GHGoAa_foldRow[data-expanded=true] .GHGoAa_foldMarker{display:none}.GHGoAa_fontToast{z-index:2147483000;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv2);pointer-events:none;border-radius:8px;padding:6px 14px;font:12px/1.5 system-ui,Segoe UI,PingFang SC,sans-serif;position:fixed;bottom:48px;left:50%;transform:translate(-50%)}.GHGoAa_readModeBtn{border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:7px;flex:none;padding:0 8px;font-size:11px;line-height:20px}.GHGoAa_readModeBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.GHGoAa_readModeBtn[data-on=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}.GHGoAa_mdPane{background:var(--dsw-alias-bg-base);flex:1;min-height:0;margin-right:12px;overflow-y:auto}.GHGoAa_mdBody{color:var(--dsw-alias-label-primary);white-space:normal;word-break:break-word;padding:14px 18px 24px;font-family:system-ui,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;font-size:13.5px;line-height:1.7}.GHGoAa_mdBody>:first-child{margin-top:0}.GHGoAa_mdHeading{color:var(--dsw-alias-label-primary);margin:1em 0 .5em;font-weight:700;line-height:1.3}.GHGoAa_mdHeading[data-level=\"1\"]{margin-top:.6em;font-size:1.6em}.GHGoAa_mdHeading[data-level=\"2\"]{font-size:1.38em}.GHGoAa_mdHeading[data-level=\"3\"]{font-size:1.2em}.GHGoAa_mdHeading[data-level=\"4\"]{font-size:1.08em}.GHGoAa_mdHeading[data-level=\"5\"]{font-size:1em}.GHGoAa_mdHeading[data-level=\"6\"]{color:var(--dsw-alias-label-secondary);font-size:.94em}.GHGoAa_mdP{margin:.6em 0}.GHGoAa_mdBody strong{font-weight:700}.GHGoAa_mdBody em{font-style:italic}.GHGoAa_mdBody s{opacity:.75}.GHGoAa_mdMark{background:color-mix(in srgb, var(--dsw-static-amber-400) 40%, transparent);color:inherit;border-radius:3px;padding:0 2px}.GHGoAa_mdCode{font-family:var(--dsw-mono-font,ui-monospace, monospace);background:var(--dsw-alias-interactive-bg-muted,var(--dsw-alias-border-l1));border-radius:4px;padding:1px 5px;font-size:.92em}.GHGoAa_mdPre{background:var(--dsw-alias-interactive-bg-muted,var(--dsw-alias-border-l1));border-radius:8px;margin:.7em 0;padding:10px 12px;overflow-x:auto}.GHGoAa_mdPre code{font-family:var(--dsw-mono-font,ui-monospace, monospace);white-space:pre;font-size:12px;line-height:1.6}.GHGoAa_mdHr{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:1.2em 0}.GHGoAa_mdQuote{border-left:3px solid var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-secondary);margin:.7em 0;padding:2px 0 2px 12px}.GHGoAa_mdList{margin:.5em 0;padding-left:1.6em}.GHGoAa_mdItem{margin:.25em 0}.GHGoAa_mdItem[data-task=true]{margin-left:-1.3em;list-style:none}.GHGoAa_mdTask{accent-color:var(--dsw-alias-state-business-primary);margin-right:6px}.GHGoAa_mdTableWrap{margin:.8em 0;overflow-x:auto}.GHGoAa_mdTable{border-collapse:collapse;max-width:100%;font-size:12.5px}.GHGoAa_mdTable th,.GHGoAa_mdTable td{border:1px solid var(--dsw-alias-border-l1);padding:5px 10px}.GHGoAa_mdTable th{background:var(--dsw-alias-interactive-bg-muted,var(--dsw-alias-border-l1));font-weight:600}.GHGoAa_mdTable tr:nth-child(2n) td{background:color-mix(in srgb, var(--dsw-alias-interactive-bg-muted,transparent) 45%, transparent)}.GHGoAa_mdImg{border-radius:8px;max-width:100%;margin:4px 0}.GHGoAa_mdFileChip{border:1px solid var(--dsw-alias-border-l1);font-size:12px;font-family:var(--dsw-mono-font,ui-monospace, monospace);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-muted,var(--dsw-alias-border-l1));border-radius:6px;align-items:center;gap:4px;padding:0 6px;display:inline-flex}.GHGoAa_mdMermaid{text-align:center;background:var(--dsw-alias-bg-base);border-radius:8px;margin:.8em 0;padding:6px 0;overflow-x:auto}.GHGoAa_mdMermaid svg{max-width:100%;height:auto}.GHGoAa_mdWiki{color:var(--dsw-alias-state-business-primary);border-bottom:1px dashed var(--dsw-alias-state-business-primary)}.GHGoAa_mdMath{padding:0 1px;font-family:Cambria Math,STIX Two Math,Georgia,serif;font-style:italic}.GHGoAa_mdMathBlock{text-align:center;white-space:pre-wrap;margin:.8em 0;padding:8px 4px;font-family:Cambria Math,STIX Two Math,Georgia,serif;font-size:1.15em;font-style:italic}.GHGoAa_mdFootnotes{border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);margin-top:1.4em;padding-top:.8em;font-size:.9em}.GHGoAa_mdFtItem{margin:.3em 0}.GHGoAa_mdFtNum{color:var(--dsw-alias-state-business-primary);margin-right:4px;font-weight:600}.GHGoAa_mdFtRef{color:var(--dsw-alias-state-business-primary);margin:0 1px;font-size:.75em}.GHGoAa_mdLink{color:var(--dsw-alias-state-business-primary)}";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"@dsh-external/dsh-file-trace/FileTrace.module.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dsh-external/dsh-file-trace";
			tag.dataset.pluginCss = "@dsh-external/dsh-file-trace/FileTrace.module.css";
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var FileTrace_module_css_default = {
			"priorUnknown": "GHGoAa_priorUnknown",
			"foldRow": "GHGoAa_foldRow",
			"close": "GHGoAa_close",
			"mdFootnotes": "GHGoAa_mdFootnotes",
			"tokMacro": "GHGoAa_tokMacro",
			"readError": "GHGoAa_readError",
			"tokKeyword": "GHGoAa_tokKeyword",
			"mdFtItem": "GHGoAa_mdFtItem",
			"mdLink": "GHGoAa_mdLink",
			"mdFtNum": "GHGoAa_mdFtNum",
			"readModeBtn": "GHGoAa_readModeBtn",
			"diffRows": "GHGoAa_diffRows",
			"drawerBody": "GHGoAa_drawerBody",
			"badge": "GHGoAa_badge",
			"foldMarker": "GHGoAa_foldMarker",
			"mdItem": "GHGoAa_mdItem",
			"drawerHead": "GHGoAa_drawerHead",
			"resizeR": "GHGoAa_resizeR",
			"filePath": "GHGoAa_filePath",
			"mdTable": "GHGoAa_mdTable",
			"mdBody": "GHGoAa_mdBody",
			"fontToast": "GHGoAa_fontToast",
			"trigger": "GHGoAa_trigger",
			"drawer": "GHGoAa_drawer",
			"drawerError": "GHGoAa_drawerError",
			"updateMsg": "GHGoAa_updateMsg",
			"opFlagError": "GHGoAa_opFlagError",
			"readContent": "GHGoAa_readContent",
			"lineNo": "GHGoAa_lineNo",
			"inlineChange": "GHGoAa_inlineChange",
			"updateBadge": "GHGoAa_updateBadge",
			"opRow": "GHGoAa_opRow",
			"resizeW": "GHGoAa_resizeW",
			"tokComment": "GHGoAa_tokComment",
			"opKind": "GHGoAa_opKind",
			"dragHandle": "GHGoAa_dragHandle",
			"opSize": "GHGoAa_opSize",
			"mdPane": "GHGoAa_mdPane",
			"readRow": "GHGoAa_readRow",
			"diffPath": "GHGoAa_diffPath",
			"opFlag": "GHGoAa_opFlag",
			"mdCode": "GHGoAa_mdCode",
			"mdPre": "GHGoAa_mdPre",
			"mdMath": "GHGoAa_mdMath",
			"diffRow": "GHGoAa_diffRow",
			"sign": "GHGoAa_sign",
			"mdMark": "GHGoAa_mdMark",
			"diffKind": "GHGoAa_diffKind",
			"mdHeading": "GHGoAa_mdHeading",
			"mdWiki": "GHGoAa_mdWiki",
			"tokNumber": "GHGoAa_tokNumber",
			"mdFtRef": "GHGoAa_mdFtRef",
			"mdTask": "GHGoAa_mdTask",
			"mdQuote": "GHGoAa_mdQuote",
			"mdMermaid": "GHGoAa_mdMermaid",
			"crashHint": "GHGoAa_crashHint",
			"mdMathBlock": "GHGoAa_mdMathBlock",
			"opTime": "GHGoAa_opTime",
			"updateDot": "GHGoAa_updateDot",
			"fileGroup": "GHGoAa_fileGroup",
			"mdP": "GHGoAa_mdP",
			"diffHead": "GHGoAa_diffHead",
			"resizeH": "GHGoAa_resizeH",
			"drawerMeta": "GHGoAa_drawerMeta",
			"tokType": "GHGoAa_tokType",
			"mdList": "GHGoAa_mdList",
			"mdImg": "GHGoAa_mdImg",
			"tokString": "GHGoAa_tokString",
			"mdTableWrap": "GHGoAa_mdTableWrap",
			"empty": "GHGoAa_empty",
			"tokFunction": "GHGoAa_tokFunction",
			"mdHr": "GHGoAa_mdHr",
			"drawerTitle": "GHGoAa_drawerTitle",
			"diffPane": "GHGoAa_diffPane",
			"mdFileChip": "GHGoAa_mdFileChip",
			"resizeT": "GHGoAa_resizeT",
			"text": "GHGoAa_text"
		};
		//#endregion
		//#region src/client/markdown.tsx
		/**
		* Markdown reading-mode renderer: an Obsidian-flavored subset rendered from
		* the trace views of .md files. Self-contained block + inline parser (no
		* runtime dependency): headings, paragraphs, YAML frontmatter, fenced code,
		* thematic breaks, nested blockquotes, nested ordered/unordered/task lists,
		* GFM tables with alignment, math blocks ($$) and inline math ($), footnotes
		* ([^id] refs + definitions); inline emphasis (bold-italic, bold ** / __,
		* italic * / _, strikethrough ~~, highlight ==), code spans, escapes, links,
		* angle autolinks, raw <img> tags, Obsidian wiki links, image embeds (URL or
		* local file via the host asset route) and generic file embeds.
		*/
		/** Host route serving the lazily-loaded mermaid chunk (and its per-diagram
		*  dynamic imports). Imported only when a ```mermaid fence is rendered. */
		const MERMAID_CHUNK_URL = "/dsh-file-trace/resources/mermaid-chunk.js";
		let chunkPromise;
		function loadMermaidChunk() {
			chunkPromise = chunkPromise ?? import(MERMAID_CHUNK_URL);
			return chunkPromise;
		}
		/** Render one mermaid fence lazily; on any failure fall back to the code block. */
		function MermaidBlock({ code }) {
			const [svg, setSvg] = (0, react.useState)(null);
			const [failed, setFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let alive = true;
				setSvg(null);
				setFailed(false);
				loadMermaidChunk().then((mod) => mod.renderMermaid(code)).then((out) => {
					if (alive) setSvg(out);
				}).catch((cause) => {
					if (!alive) return;
					console.warn("[dsh-file-trace] mermaid chunk fell back to code block:", cause);
					setFailed(true);
				});
				return () => {
					alive = false;
				};
			}, [code]);
			if (failed || svg === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
				className: FileTrace_module_css_default.mdPre,
				"data-lang": "mermaid",
				"data-mermaid-state": failed ? "failed" : "loading",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: code })
			}, "mdmermaid");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-mermaid-state": "rendered",
				className: FileTrace_module_css_default.mdMermaid,
				dangerouslySetInnerHTML: { __html: svg }
			}, "mdmermaid");
		}
		/** True when a traced path is a markdown source this renderer handles. */
		function isMarkdownPath(path) {
			return /\.(md|markdown|mdx)$/i.test(path);
		}
		/** True for URLs a browser <img> can load directly (remote/data/blob). */
		function isLoadableImage(url) {
			return /^(https?:|data:image\/|blob:)/i.test(url);
		}
		/** Local image extensions the host asset route serves (no SVG: scripts). */
		const LOCAL_IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i;
		/** Host route that streams a whitelisted local image by absolute path. */
		function assetUrl(abs) {
			return "/dsh-file-trace/asset?path=" + encodeURIComponent(abs.replace(/\\/g, "/"));
		}
		/** Resolve one embed target against the traced file's directory. */
		function resolveLocal(target, baseDir) {
			if (/^([a-z]:[\\/]|\\\\|\/)/i.test(target)) return target;
			if (baseDir === void 0) return void 0;
			return baseDir.replace(/[\\/]+$/, "") + "/" + target.replace(/^[.][/]/, "");
		}
		/** Match an ATX heading line; capture level and text. */
		const HEADING_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
		/** Match a thematic break line (---, ***, ___ with three or more). */
		const HR_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:[ _][ \t]*){3,})$/;
		/** Match a fenced-code opening line; capture the marker run and info text. */
		const FENCE_RE = /^ {0,3}(\x60{3,}|~{3,})\s*(.*)$/;
		/** Match a blockquote marker line; capture the content after '>'. */
		const QUOTE_RE = /^ {0,3}>\s?(.*)$/;
		/** Match a bullet list item line. */
		const BULLET_RE = /^(\s*)([-*+])(\s+)(.*)$/;
		/** Match an ordered list item line. */
		const ORDERED_RE = /^(\s*)(\d{1,9})([.)])(\s+)(.*)$/;
		/** Match a GFM table delimiter row (e.g. | :--- | ---: |). */
		const TABLE_DELIM_RE = /^\s*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?\s*$/;
		/** Match a task-item checkbox prefix. */
		const TASK_RE = /^\[([ xX])\]\s+/;
		/** Match a footnote definition line; capture id and first text line. */
		const FOOTDEF_RE = /^\[\^([^\]\s]+)\]:\s?(.*)$/;
		/** Regex special characters escaped for RegExp construction. */
		const RE_ESCAPE = /[.*+?^$()|[\]{}\\]/g;
		/** Visible width of a string with tabs expanded to 4 columns. */
		function indentWidth(s) {
			let w = 0;
			for (const ch of s) w += ch === "	" ? 4 - w % 4 : 1;
			return w;
		}
		/** True when a line starts a block that interrupts a paragraph. */
		function interruptsParagraph(line) {
			return line.trim() === "" || HEADING_RE.test(line) || HR_RE.test(line) || FENCE_RE.test(line) || QUOTE_RE.test(line) || BULLET_RE.test(line) || ORDERED_RE.test(line);
		}
		/** Split one table row on unescaped pipes; drops the wrapping border pipes. */
		function splitRow(line) {
			const cells = line.replace(/\\\|/g, "\0").split("|").map((c) => c.replace(/\u0000/g, "|").trim());
			if (cells.length > 1 && cells[0] === "") cells.shift();
			if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
			return cells;
		}
		/** Extract footnote definitions (with indented continuations) from the body. */
		function extractFootnotes(src) {
			const lines = src.replace(/\r\n?/g, "\n").split("\n");
			const ids = [];
			const texts = /* @__PURE__ */ new Map();
			const kept = [];
			let i = 0;
			while (i < lines.length) {
				const m = lines[i].match(FOOTDEF_RE);
				if (m === null) {
					kept.push(lines[i]);
					i += 1;
					continue;
				}
				const id = m[1];
				const parts = [m[2] ?? ""];
				i += 1;
				while (i < lines.length && /^(\s{4,}|\t)\S/.test(lines[i])) {
					parts.push(lines[i].trim());
					i += 1;
				}
				if (!texts.has(id)) ids.push(id);
				texts.set(id, parts.join(" "));
			}
			return {
				body: kept.join("\n"),
				ids,
				texts
			};
		}
		/**
		* Parse markdown source into a block tree (Obsidian-flavored subset).
		* @param src - the full markdown text.
		* @returns the top-level blocks in order.
		*/
		function parseBlocks(src) {
			const lines = src.replace(/\r\n?/g, "\n").split("\n");
			const blocks = [];
			let i = 0;
			if (lines[0] !== void 0 && lines[0].trim() === "---") {
				let j = 1;
				while (j < lines.length && lines[j].trim() !== "---") j += 1;
				if (j < lines.length) {
					blocks.push({
						kind: "frontmatter",
						text: lines.slice(1, j).join("\n")
					});
					i = j + 1;
				}
			}
			while (i < lines.length) {
				const line = lines[i];
				if (line.trim() === "") {
					i += 1;
					continue;
				}
				if (line.trim().startsWith("$$")) {
					const first = line.trim();
					const parts = [];
					if (first.endsWith("$$") && first.length > 4) {
						parts.push(first.slice(2, -2));
						i += 1;
					} else {
						if (first.length > 2) parts.push(first.slice(2));
						i += 1;
						while (i < lines.length && !lines[i].trim().endsWith("$$")) {
							parts.push(lines[i]);
							i += 1;
						}
						if (i < lines.length) {
							const last = lines[i].trim();
							parts.push(last.slice(0, last.length - 2));
							i += 1;
						}
					}
					blocks.push({
						kind: "math",
						text: parts.join("\n").trim()
					});
					continue;
				}
				const fence = line.match(FENCE_RE);
				if (fence !== null) {
					const marker = fence[1];
					const ch = marker[0];
					const count = marker.length;
					const body = [];
					i += 1;
					while (i < lines.length) {
						const t = lines[i].trim();
						const tCount = t.length - t.replaceAll(ch, "").length;
						if (tCount === t.length && tCount >= count) break;
						body.push(lines[i]);
						i += 1;
					}
					if (i < lines.length) i += 1;
					blocks.push({
						kind: "code",
						lang: (fence[2] ?? "").trim(),
						text: body.join("\n")
					});
					continue;
				}
				if (HR_RE.test(line)) {
					blocks.push({ kind: "hr" });
					i += 1;
					continue;
				}
				const heading = line.match(HEADING_RE);
				if (heading !== null) {
					blocks.push({
						kind: "heading",
						level: heading[1].length,
						text: heading[2] ?? ""
					});
					i += 1;
					continue;
				}
				if (QUOTE_RE.test(line)) {
					const body = [];
					while (i < lines.length) {
						const m = lines[i].match(QUOTE_RE);
						if (m !== null) {
							body.push(m[1]);
							i += 1;
							continue;
						}
						if (lines[i].trim() !== "" && body.length > 0 && !interruptsParagraph(lines[i])) {
							body.push(lines[i]);
							i += 1;
							continue;
						}
						break;
					}
					blocks.push({
						kind: "quote",
						blocks: parseBlocks(body.join("\n"))
					});
					continue;
				}
				const bullet = line.match(BULLET_RE);
				const orderedM = line.match(ORDERED_RE);
				if (bullet !== null || orderedM !== null) {
					const isOrdered = orderedM !== null;
					const firstM = isOrdered ? orderedM : bullet;
					const indent = indentWidth(firstM[1]);
					const contentIndent = indent + (isOrdered ? firstM[2].length + 1 : 1) + 1;
					const start = isOrdered ? Number(firstM[2]) : 1;
					const items = [];
					while (i < lines.length) {
						const mb = lines[i].match(BULLET_RE);
						const mo = lines[i].match(ORDERED_RE);
						const m = isOrdered ? mo : mb;
						if (m === null || indentWidth(m[1]) !== indent) break;
						const first = m[m.length - 1];
						i += 1;
						const body = [];
						const taskMatch = first.match(TASK_RE);
						const task = taskMatch !== null;
						const checked = task && taskMatch[1].toLowerCase() === "x";
						body.push(task ? first.slice(taskMatch[0].length) : first);
						while (i < lines.length) {
							const cont = lines[i];
							if (cont.trim() === "") {
								let j = i + 1;
								while (j < lines.length && lines[j].trim() === "") j += 1;
								const next = j < lines.length ? lines[j] : "";
								const nextIndent = indentWidth(next.match(/^(\s*)/)[1]);
								const nextIsItem = BULLET_RE.test(next) || ORDERED_RE.test(next);
								if (next.trim() !== "" && (nextIndent >= contentIndent || nextIsItem)) {
									body.push("");
									i += 1;
									continue;
								}
								break;
							}
							if (indentWidth(cont.match(/^(\s*)/)[1]) >= contentIndent) {
								body.push(cont.trimStart());
								i += 1;
								continue;
							}
							if (BULLET_RE.test(cont) || ORDERED_RE.test(cont) || FENCE_RE.test(cont) || HEADING_RE.test(cont) || HR_RE.test(cont) || QUOTE_RE.test(cont)) break;
							body.push(cont.trimStart());
							i += 1;
						}
						items.push({
							blocks: parseBlocks(body.join("\n")),
							task,
							checked
						});
					}
					blocks.push({
						kind: "list",
						ordered: isOrdered,
						start,
						items
					});
					continue;
				}
				if (line.includes("|") && i + 1 < lines.length && TABLE_DELIM_RE.test(lines[i + 1])) {
					const header = splitRow(line);
					const align = splitRow(lines[i + 1]).map((c) => {
						const left = c.startsWith(":");
						const right = c.endsWith(":");
						return left && right ? "center" : right ? "right" : "left";
					});
					i += 2;
					const rows = [header];
					while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
						rows.push(splitRow(lines[i]));
						i += 1;
					}
					blocks.push({
						kind: "table",
						align,
						rows
					});
					continue;
				}
				const para = [line];
				i += 1;
				while (i < lines.length && !interruptsParagraph(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && TABLE_DELIM_RE.test(lines[i + 1]))) {
					para.push(lines[i]);
					i += 1;
				}
				blocks.push({
					kind: "para",
					text: para.join("\n")
				});
			}
			return blocks;
		}
		/** Emphasis markers applied by the inline scanner, longest first. */
		const EMPHASIS = [
			{
				marker: "***",
				tags: ["strong", "em"]
			},
			{
				marker: "___",
				tags: ["strong", "em"]
			},
			{
				marker: "**",
				tags: ["strong"]
			},
			{
				marker: "__",
				tags: ["strong"]
			},
			{
				marker: "~~",
				tags: ["s"]
			},
			{
				marker: "==",
				tags: ["mark"]
			},
			{
				marker: "*",
				tags: ["em"]
			},
			{
				marker: "_",
				tags: ["em"]
			}
		];
		/** Escape a literal marker for use inside a RegExp. */
		function escapeRe(s) {
			return s.replace(RE_ESCAPE, "\\$&");
		}
		/** One attribute value of a raw HTML tag (double or single quoted). */
		function attrOf(tag, name) {
			return (tag.match(new RegExp("\\s" + name + "\\s*=\\s*\"([^\"]*)\"", "i")) ?? tag.match(new RegExp("\\s" + name + "\\s*=\\s*'([^']*)'", "i")))?.[1];
		}
		/** One inline image: loadable URLs render; local image files render through
		* the host asset route; anything else falls back to a file chip. */
		function renderEmbed(target, alt, key, rctx, width) {
			const name = (target.split(/[\\/]/).pop() || alt || target).split("?")[0];
			if (isLoadableImage(target)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				src: target,
				alt: alt || name,
				className: FileTrace_module_css_default.mdImg,
				loading: "lazy"
			}, key);
			if (LOCAL_IMAGE_RE.test(target)) {
				const abs = resolveLocal(target, rctx.baseDir);
				if (abs !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: assetUrl(abs),
					alt: alt || name,
					className: FileTrace_module_css_default.mdImg,
					loading: "lazy",
					style: width !== void 0 ? { width: Number(width) || void 0 } : void 0
				}, key);
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: FileTrace_module_css_default.mdFileChip,
				title: target,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": true,
						children: "🗎"
					}),
					" ",
					name
				]
			}, key);
		}
		/**
		* Render one text run as inline nodes: emphasis, code spans, links, embeds,
		* math, footnotes and raw <img> tags.
		* @param text - the raw inline text.
		* @param keyBase - stable React key prefix for produced nodes.
		* @param rctx - rendering context (base directory, footnote numbers).
		* @returns the inline nodes in order.
		*/
		function renderInline(text, keyBase = "i", rctx = {}) {
			const nodes = [];
			let buf = "";
			let k = 0;
			const flush = () => {
				if (buf !== "") {
					nodes.push(buf);
					buf = "";
				}
			};
			const key = () => keyBase + "-" + String(k++);
			let pos = 0;
			while (pos < text.length) {
				const rest = text.slice(pos);
				const ch = text[pos];
				if (ch === "\\" && pos + 1 < text.length && /[\\\x60*_{}[\]()#+\-.!~>|=$]/.test(text[pos + 1])) {
					buf += text[pos + 1];
					pos += 2;
					continue;
				}
				if (ch === "`") {
					const m = rest.match(/^(\x60+)([\s\S]*?)\1/);
					if (m !== null) {
						let code = m[2] ?? "";
						if (code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") code = code.slice(1, -1);
						flush();
						nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
							className: FileTrace_module_css_default.mdCode,
							children: code
						}, key()));
						pos += m[0].length;
						continue;
					}
				}
				if (ch === "$") {
					const m = rest.match(/^\$(?!\s)([^$\n]*[^\s$])\$/);
					if (m !== null) {
						flush();
						nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FileTrace_module_css_default.mdMath,
							children: m[1]
						}, key()));
						pos += m[0].length;
						continue;
					}
				}
				if (ch === "[" && rest.startsWith("[^")) {
					const m = rest.match(/^\[\^([^\]\s]+)\]/);
					const num = m !== null ? rctx.footnotes?.get(m[1]) : void 0;
					if (m !== null && num !== void 0) {
						flush();
						nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("sup", {
							className: FileTrace_module_css_default.mdFtRef,
							id: "file-trace-ftref-" + String(num),
							children: String(num)
						}, key()));
						pos += m[0].length;
						continue;
					}
				}
				let m = rest.match(/^!\[\[([^\]]+)\]\]/);
				if (m !== null) {
					flush();
					nodes.push(renderEmbed(m[1].trim(), "", key(), rctx));
					pos += m[0].length;
					continue;
				}
				m = rest.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
				if (m !== null) {
					flush();
					const target = m[1].trim();
					const label = (m[2] ?? target).trim();
					nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FileTrace_module_css_default.mdWiki,
						title: target,
						children: renderInline(label, keyBase + "w", rctx)
					}, key()));
					pos += m[0].length;
					continue;
				}
				m = rest.match(/^!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\)/);
				if (m !== null) {
					flush();
					nodes.push(renderEmbed(m[2].trim(), ((m[1] ?? "") + " " + (m[3] ?? "")).trim(), key(), rctx));
					pos += m[0].length;
					continue;
				}
				m = rest.match(/^\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\)/);
				if (m !== null) {
					flush();
					const href = m[2] ?? "";
					const safe = /^(https?:|mailto:|#|\/)/i.test(href) ? href : "";
					nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						className: FileTrace_module_css_default.mdLink,
						href: safe,
						target: "_blank",
						rel: "noreferrer noopener",
						title: safe || href,
						children: renderInline(m[1] ?? "", keyBase + "l", rctx)
					}, key()));
					pos += m[0].length;
					continue;
				}
				if (ch === "<") {
					m = rest.match(/^<img\s[^>]*\/?>/i);
					if (m !== null) {
						const src = attrOf(m[0], "src");
						if (src !== void 0 && src !== "") {
							flush();
							nodes.push(renderEmbed(src.trim(), attrOf(m[0], "alt") ?? "", key(), rctx, attrOf(m[0], "width")));
							pos += m[0].length;
							continue;
						}
					}
					m = rest.match(/^<(https?:\/\/[^\s<>]+)>/);
					if (m !== null) {
						flush();
						nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
							className: FileTrace_module_css_default.mdLink,
							href: m[1],
							target: "_blank",
							rel: "noreferrer noopener",
							children: m[1]
						}, key()));
						pos += m[0].length;
						continue;
					}
				}
				if (rest.startsWith("http://") || rest.startsWith("https://")) {
					m = rest.match(/^https?:\/\/[^\s<>()\[\]\x60]+/);
					if (m !== null) {
						flush();
						nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
							className: FileTrace_module_css_default.mdLink,
							href: m[0],
							target: "_blank",
							rel: "noreferrer noopener",
							children: m[0]
						}, key()));
						pos += m[0].length;
						continue;
					}
				}
				let matched = false;
				for (const e of EMPHASIS) {
					if (!rest.startsWith(e.marker)) continue;
					if (e.marker.includes("_") && pos > 0 && /\w/.test(text[pos - 1])) continue;
					const re = new RegExp(escapeRe(e.marker) + "(?=\\S)([\\s\\S]*?\\S)" + escapeRe(e.marker));
					const em = text.slice(pos).match(re);
					if (em === null) continue;
					flush();
					let inner = renderInline(em[1], keyBase + "e", rctx);
					for (const tag of e.tags) inner = nest(tag, inner, key());
					nodes.push(inner);
					pos += em[0].length;
					matched = true;
					break;
				}
				if (matched) continue;
				buf += ch;
				pos += 1;
			}
			flush();
			return nodes;
		}
		/** Wrap inline nodes in one emphasis element. */
		function nest(tag, children, key) {
			if (tag === "strong") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children }, key);
			if (tag === "em") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", { children }, key);
			if (tag === "s") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("s", { children }, key);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("mark", {
				className: FileTrace_module_css_default.mdMark,
				children
			}, key);
		}
		/** Render one block (recursively) as an element. */
		function renderBlock(b, key, rctx) {
			switch (b.kind) {
				case "heading": {
					const Tag = "h" + String(b.level);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tag, {
						className: FileTrace_module_css_default.mdHeading,
						"data-level": String(b.level),
						children: renderInline(b.text, key, rctx)
					}, key);
				}
				case "para": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: FileTrace_module_css_default.mdP,
					children: renderInline(b.text, key, rctx)
				}, key);
				case "code":
					if (b.lang.toLowerCase() === "mermaid") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MermaidBlock, { code: b.text }, key);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: FileTrace_module_css_default.mdPre,
						"data-lang": b.lang || void 0,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: b.text })
					}, key);
				case "frontmatter": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					className: FileTrace_module_css_default.mdPre,
					"data-lang": "yaml",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: b.text })
				}, key);
				case "math": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: FileTrace_module_css_default.mdMathBlock,
					children: b.text
				}, key);
				case "hr": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", { className: FileTrace_module_css_default.mdHr }, key);
				case "quote": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("blockquote", {
					className: FileTrace_module_css_default.mdQuote,
					children: b.blocks.map((q, n) => renderBlock(q, key + "-" + String(n), rctx))
				}, key);
				case "list": {
					const Tag = b.ordered ? "ol" : "ul";
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tag, {
						className: FileTrace_module_css_default.mdList,
						start: b.ordered && b.start !== 1 ? b.start : void 0,
						children: b.items.map((item, n) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: FileTrace_module_css_default.mdItem,
							"data-task": item.task ? "true" : void 0,
							children: [item.task && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: item.checked,
								readOnly: true,
								className: FileTrace_module_css_default.mdTask
							}), item.blocks.length === 1 && item.blocks[0].kind === "para" ? renderInline(item.blocks[0].text, key + "-" + String(n), rctx) : item.blocks.map((ib, j) => renderBlock(ib, key + "-" + String(n) + "-" + String(j), rctx))]
						}, key + "-" + String(n)))
					}, key);
				}
				case "table": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: FileTrace_module_css_default.mdTableWrap,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
						className: FileTrace_module_css_default.mdTable,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: b.rows[0].map((cell, n) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							style: { textAlign: b.align[n] === "right" ? "right" : b.align[n] === "center" ? "center" : "left" },
							children: renderInline(cell, key + "h" + String(n), rctx)
						}, key + "-h-" + String(n))) }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: b.rows.slice(1).map((row, r) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: row.map((cell, n) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
							style: { textAlign: b.align[n] === "right" ? "right" : b.align[n] === "center" ? "center" : "left" },
							children: renderInline(cell, key + "c" + String(r) + String(n), rctx)
						}, key + "-r-" + String(r) + "-" + String(n))) }, key + "-r-" + String(r))) })]
					})
				}, key);
			}
		}
		/** Reading-mode view of one markdown document. */
		function MarkdownView({ src, baseDir }) {
			const { blocks, footnotes } = (0, react.useMemo)(() => {
				const set = extractFootnotes(src);
				const map = /* @__PURE__ */ new Map();
				set.ids.forEach((id, n) => {
					map.set(id, n + 1);
				});
				return {
					blocks: parseBlocks(set.body),
					footnotes: {
						set,
						map
					}
				};
			}, [src]);
			const rctx = {
				...baseDir === void 0 ? {} : { baseDir },
				footnotes: footnotes.map
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FileTrace_module_css_default.mdBody,
				"data-file-trace-md": true,
				children: [blocks.map((b, i) => renderBlock(b, String(i), rctx)), footnotes.set.ids.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
					className: FileTrace_module_css_default.mdFootnotes,
					children: footnotes.set.ids.map((id, n) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: FileTrace_module_css_default.mdFtItem,
						id: "file-trace-ft-" + String(n + 1),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: FileTrace_module_css_default.mdFtNum,
							children: [String(n + 1), "."]
						}), renderInline(footnotes.set.texts.get(id) ?? "", "ft" + String(n), rctx)]
					}, "ft-" + String(n)))
				}, "footnotes")]
			});
		}
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
			state = {
				failed: false,
				message: ""
			};
			static getDerivedStateFromError(error) {
				return {
					failed: true,
					message: String(error?.message ?? error)
				};
			}
			componentDidCatch(error) {
				renderCompatBanner("dsh-file-trace", "@dsh-external/dsh-file-trace", `渲染出错：${String(error?.message ?? error)}`, ["请将插件更新到适配当前 DSH 的版本；", "或在插件目录执行 pnpm run build 后刷新页面。"]);
			}
			render() {
				if (this.state.failed) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: FileTrace_module_css_default.drawerError,
					"data-file-trace-error": true,
					children: ["渲染出错：", this.state.message]
				});
				return this.props.children;
			}
		};
		/** Long diff lines fold to one ellipsized row; the threshold is the char count. */
		const FOLD_THRESHOLD = 120;
		/** Token class -> CSS color class ('' inherits the row's diff color). */
		const TOKEN_CLASS = {
			plain: "",
			comment: FileTrace_module_css_default.tokComment ?? "",
			string: FileTrace_module_css_default.tokString ?? "",
			keyword: FileTrace_module_css_default.tokKeyword ?? "",
			number: FileTrace_module_css_default.tokNumber ?? "",
			type: FileTrace_module_css_default.tokType ?? "",
			function: FileTrace_module_css_default.tokFunction ?? "",
			macro: FileTrace_module_css_default.tokMacro ?? ""
		};
		/** One token span's class list: its color class, plus the change tint. */
		function tokenSpanClass(type, changed) {
			const color = TOKEN_CLASS[type];
			return changed ? `${color} ${FileTrace_module_css_default.inlineChange}` : color;
		}
		/** Render scanned tokens as colored nodes; uncolored runs stay text. */
		function tokensToNodes(tokens, changed = false) {
			const nodes = [];
			for (const token of tokens) if (!changed && !isColored(token)) nodes.push(token.text);
			else nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: tokenSpanClass(token.type, changed),
				children: token.text
			}, String(nodes.length)));
			return nodes;
		}
		/** Per-row block-comment entry state for a diff: the old side threads along
		*  old-line order and the new side along new-line order (the LCS row order
		*  preserves both), so multi-line comments color correctly on each side. */
		function diffBlockEntries(rows, lang) {
			const entries = /* @__PURE__ */ new Map();
			if (!hasBlockComment(lang)) return entries;
			let oldIn = false;
			let newIn = false;
			for (const row of rows) {
				const isOld = row.oldLine !== void 0;
				const isNew = row.newLine !== void 0;
				entries.set(row, isOld ? oldIn : newIn);
				if (isOld) oldIn = scanLine(row.text, lang, oldIn).inBlock;
				if (isNew) newIn = scanLine(row.text, lang, newIn).inBlock;
			}
			return entries;
		}
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
			const [checkFailed, setCheckFailed] = (0, react.useState)(false);
			const [updating, setUpdating] = (0, react.useState)(false);
			const [updateMsg, setUpdateMsg] = (0, react.useState)(null);
			const [selected, setSelected] = (0, react.useState)(null);
			const [mdReading, setMdReading] = (0, react.useState)(false);
			const [expandedLines, setExpandedLines] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [expandedFolds, setExpandedFolds] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [diffHeight, setDiffHeight] = (0, react.useState)(340);
			(0, react.useRef)(null);
			const scrollPaneRef = (0, react.useRef)(null);
			const scrollMemoryRef = (0, react.useRef)(/* @__PURE__ */ new Map());
			const listScrollRef = (0, react.useRef)(null);
			const listScrollMemoryRef = (0, react.useRef)(void 0);
			const MIN_FONT = 9;
			const MAX_FONT = 28;
			const LS_LIST_FONT = "dsh-file-trace:listFont";
			const LS_PANE_FONT = "dsh-file-trace:paneFont";
			const readFont = (key) => {
				try {
					const saved = window.localStorage.getItem(key);
					if (saved !== null) {
						const n = Number(saved);
						if (Number.isFinite(n)) return Math.min(Math.max(n, MIN_FONT), MAX_FONT);
					}
				} catch {}
			};
			const [listFont, setListFont] = (0, react.useState)(() => readFont(LS_LIST_FONT) ?? 12);
			const [paneFont, setPaneFont] = (0, react.useState)(() => readFont(LS_PANE_FONT) ?? 12);
			const drawerRef = (0, react.useRef)(null);
			const paneFontRef = (0, react.useRef)(paneFont);
			paneFontRef.current = paneFont;
			const listFontRef = (0, react.useRef)(listFont);
			listFontRef.current = listFont;
			const fontToast = (message) => {
				const existing = document.getElementById("dsh-file-trace-font-toast");
				if (existing !== null) existing.remove();
				const el = document.createElement("div");
				el.id = "dsh-file-trace-font-toast";
				el.className = FileTrace_module_css_default.fontToast ?? "";
				el.textContent = message;
				document.body.appendChild(el);
				window.setTimeout(() => {
					el.remove();
				}, 1600);
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				const onFontWheel = (e) => {
					if (!e.ctrlKey) return;
					const target = e.target instanceof Node ? e.target : null;
					const drawer = drawerRef.current;
					if (drawer === null || target === null || !drawer.contains(target)) return;
					e.preventDefault();
					const inPane = target instanceof Element && target.closest("[data-file-trace-diff]") !== null;
					const step = e.deltaY < 0 ? 1 : -1;
					const current = inPane ? paneFontRef.current : listFontRef.current;
					const next = Math.min(Math.max(current + step, MIN_FONT), MAX_FONT);
					if (next === current) {
						fontToast(t(step < 0 ? "font.min" : "font.max", { px: String(step < 0 ? MIN_FONT : MAX_FONT) }));
						return;
					}
					if (inPane) setPaneFont(next);
					else setListFont(next);
					try {
						window.localStorage.setItem(inPane ? LS_PANE_FONT : LS_LIST_FONT, String(next));
					} catch {}
				};
				document.addEventListener("wheel", onFontWheel, {
					passive: false,
					capture: true
				});
				return () => {
					document.removeEventListener("wheel", onFontWheel, { capture: true });
				};
			}, [open, t]);
			const LS_POS = "dsh-file-trace:pos";
			const LS_SIZE = "dsh-file-trace:size";
			const [winPos, setWinPos] = (0, react.useState)(() => {
				try {
					const saved = window.localStorage.getItem(LS_POS);
					if (saved !== null) {
						const p = JSON.parse(saved);
						if (typeof p.x === "number" && Number.isFinite(p.x) && typeof p.y === "number" && Number.isFinite(p.y)) return {
							x: Math.min(Math.max(p.x, 8), Math.max(8, window.innerWidth - 300)),
							y: Math.min(Math.max(p.y, 8), Math.max(8, window.innerHeight - 120))
						};
					}
				} catch {}
				return {
					x: Math.max(16, window.innerWidth - 576),
					y: Math.max(16, Math.round(window.innerHeight * .12))
				};
			});
			const [winSize, setWinSize] = (0, react.useState)(() => {
				try {
					const saved = window.localStorage.getItem(LS_SIZE);
					if (saved !== null) {
						const s = JSON.parse(saved);
						if (typeof s.w === "number" && Number.isFinite(s.w) && typeof s.h === "number" && Number.isFinite(s.h)) return {
							w: Math.min(Math.max(s.w, 360), window.innerWidth - 16),
							h: Math.min(Math.max(s.h, 200), window.innerHeight - 16)
						};
					}
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
			/** Resize the floating window from the top edge (bottom edge anchored). */
			const startWinResizeHT = (e) => {
				e.preventDefault();
				const startY = e.clientY;
				const startH = sizeRef.current.h;
				const bottom = posRef.current.y + startH;
				const onMove = (ev) => {
					const h = Math.min(Math.max(startH + (startY - ev.clientY), 200), window.innerHeight - 8);
					setWinSize((prev) => ({
						...prev,
						h
					}));
					setWinPos((prev) => ({
						...prev,
						y: bottom - h
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
			/** Resize the floating window from the right edge (left edge anchored). */
			const startWinResizeWR = (e) => {
				e.preventDefault();
				const startX = e.clientX;
				const startW = sizeRef.current.w;
				const onMove = (ev) => {
					const w = Math.min(Math.max(startW + (ev.clientX - startX), 360), window.innerWidth - posRef.current.x - 8);
					setWinSize((prev) => ({
						...prev,
						w
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
				fetchLatestTag().then((tag) => {
					if (tag !== void 0) setLatestTag((prev) => prev !== void 0 ? prev : tag);
					else setCheckFailed(true);
				});
			}, []);
			const newerTag = latestTag !== void 0 && compareSemver(latestTag, PLUGIN_VERSION) > 0 ? latestTag : void 0;
			/** One-click update: host endpoint first; on failure, copy the prompt. */
			const onUpdateClick = () => {
				if (newerTag === void 0 || updating) return;
				setUpdating(true);
				setUpdateMsg(null);
				runUpdate(newerTag).then((result) => {
					setUpdating(false);
					if (result.ok) {
						setUpdateMsg(result.hostChanged === true ? `已更新到 ${newerTag}（含宿主侧变更），请重启 dsh 生效` : `已更新到 ${newerTag}，客户端自动刷新生效（未见变化可硬刷新）`);
						return;
					}
					if (result.link) {
						navigator.clipboard?.writeText(updatePrompt(newerTag)).then(() => setUpdateMsg(`本地 link 安装：自动更新会断开本地开发链接，已跳过；已把更新提示词复制到剪贴板——若想切换为 git 依赖安装并自动更新，请先以 git 方式安装本插件`)).catch(() => setUpdateMsg(`本地 link 安装：自动更新已跳过。请手动执行：dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:lhh010/dsh-file-trace#${newerTag}'`));
						return;
					}
					navigator.clipboard?.writeText(updatePrompt(newerTag)).then(() => {
						setUpdateMsg(`自动更新失败（${result.detail.slice(0, 80)}）；已复制更新提示词到剪贴板，粘贴发送即可${result.recovery !== void 0 ? `；恢复命令：${result.recovery}` : ""}`);
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
			const selectedLang = (0, react.useMemo)(() => selected === null ? void 0 : langOfPath(selected.path), [selected]);
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
			const blockEntries = (0, react.useMemo)(() => diffBlockEntries(diffRows, selectedLang), [diffRows, selectedLang]);
			const readRows = (0, react.useMemo)(() => {
				if (selectedOp?.kind !== "read" || selectedOp.read === void 0) return [];
				let state = false;
				return parseReadLines(selectedOp.read).map((line) => {
					const scan = scanLine(line.text, selectedLang, state);
					state = scan.inBlock;
					return {
						line: line.line,
						nodes: tokensToNodes(scan.tokens)
					};
				});
			}, [selectedOp, selectedLang]);
			const readingSrc = (0, react.useMemo)(() => {
				if (selected === null || !isMarkdownPath(selected.path)) return "";
				const op = selected.op;
				if (op.kind === "read") return parseReadContent(op.read ?? "");
				if (op.kind === "write") return op.content ?? "";
				if (op.kind === "edit" && op.edit !== void 0) {
					const prior = knownContentBefore(ops, selected.path, op);
					if (prior !== void 0 && prior.includes(op.edit.oldString)) return prior.replace(op.edit.oldString, op.edit.newString);
					return op.edit.newString;
				}
				return "";
			}, [selected, ops]);
			(0, react.useEffect)(() => {
				setExpandedLines(/* @__PURE__ */ new Set());
				setExpandedFolds(/* @__PURE__ */ new Set());
				setMdReading(false);
			}, [selectedOp]);
			(0, react.useEffect)(() => {
				const el = scrollPaneRef.current;
				if (el === null) return;
				el.scrollTop = scrollMemoryRef.current.get(selectedOp?.callId ?? "") ?? 0;
			}, [selectedOp, open]);
			(0, react.useEffect)(() => {
				const el = listScrollRef.current;
				if (el === null) return;
				const saved = listScrollMemoryRef.current;
				if (saved !== void 0) el.scrollTop = saved;
			}, [selectedOp]);
			const renderDiffRow = (row, rowKey, lang) => {
				const isLong = row.text.length > FOLD_THRESHOLD;
				const blockEntry = blockEntries.get(row) ?? false;
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
								if (inline === void 0) return tokensToNodes(scanLine(row.text, lang, blockEntry).tokens);
								const side = coalesceInline(row.oldLine !== void 0 ? inline.old : inline.next);
								const nodes = [];
								let state = blockEntry;
								for (const seg of side) {
									const scan = scanLine(seg.text, lang, state);
									state = scan.inBlock;
									nodes.push(...tokensToNodes(scan.tokens, seg.changed));
								}
								return nodes;
							})(), row.kind !== "mod" && tokensToNodes(scanLine(row.text, lang, blockEntry).tokens)]
						})
					]
				}, rowKey);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: FileTrace_module_css_default.trigger,
				"data-file-trace-trigger": true,
				title: t("open"),
				"aria-label": `${t("title")} (${String(count)})`,
				onClick: () => {
					setOpen((prev) => !prev);
					setSelected(null);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FileTrace_module_css_default.triggerLabel,
						children: t("title")
					}),
					count > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FileTrace_module_css_default.badge,
						children: String(count)
					}),
					newerTag !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FileTrace_module_css_default.updateDot,
						title: `新版本 ${newerTag} 可用`,
						children: "⟳"
					})
				]
			}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DrawerErrorBoundary, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FileTrace_module_css_default.drawer,
				"data-file-trace-drawer": true,
				ref: drawerRef,
				"data-dock": docked ? "right" : void 0,
				role: "dialog",
				"aria-label": t("title"),
				style: {
					"--ft-list-font": `${String(listFont)}px`,
					"--ft-pane-font": `${String(paneFont)}px`,
					...docked ? {
						left: window.innerWidth - winSize.w,
						top: 0,
						width: winSize.w,
						height: window.innerHeight
					} : {
						left: Number.isFinite(winPos.x) ? Math.min(Math.max(winPos.x, 8), Math.max(8, window.innerWidth - 360)) : Math.max(16, window.innerWidth - 576),
						top: Number.isFinite(winPos.y) ? Math.min(Math.max(winPos.y, 8), Math.max(8, window.innerHeight - 120)) : 16,
						width: Number.isFinite(winSize.w) ? Math.min(Math.max(winSize.w, 360), window.innerWidth - 16) : Math.min(560, window.innerWidth - 16),
						height: Number.isFinite(winSize.h) ? Math.min(Math.max(winSize.h, 200), window.innerHeight - 16) : Math.min(720, window.innerHeight - 16)
					}
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
					docked ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: FileTrace_module_css_default.resizeT,
						"data-ft-resize-t": true,
						onPointerDown: startWinResizeHT,
						role: "separator",
						"aria-orientation": "horizontal"
					}),
					docked ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: FileTrace_module_css_default.resizeR,
						"data-ft-resize-r": true,
						onPointerDown: startWinResizeWR,
						role: "separator",
						"aria-orientation": "vertical"
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
								title: updateMsg,
								children: updateMsg
							}),
							checkFailed && newerTag === void 0 && updateMsg === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileTrace_module_css_default.updateMsg,
								title: "无法连接宿主端点 / GitHub，稍后重开抽屉重试",
								children: "⚠ 版本检查失败"
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
						ref: listScrollRef,
						onScroll: (e) => {
							listScrollMemoryRef.current = e.currentTarget.scrollTop;
						},
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
									isMarkdownPath(selected.path) && !selected.op.isError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: FileTrace_module_css_default.readModeBtn,
										"data-on": mdReading ? "true" : void 0,
										onClick: () => {
											setMdReading((prev) => !prev);
										},
										title: mdReading ? t("md.raw") : t("md.read"),
										children: mdReading ? t("md.raw") : t("md.read")
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
							selected.op.isError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FileTrace_module_css_default.readContent,
								"data-file-trace-read": true,
								"data-error": "true",
								ref: scrollPaneRef,
								onScroll: (e) => {
									scrollMemoryRef.current.set(selectedOp?.callId ?? "", e.currentTarget.scrollTop);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: FileTrace_module_css_default.readError,
									role: "alert",
									children: selected.op.errorText ?? t("error")
								})
							}) : mdReading && isMarkdownPath(selected.path) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FileTrace_module_css_default.mdPane,
								"data-file-trace-md-pane": true,
								ref: scrollPaneRef,
								onScroll: (e) => {
									scrollMemoryRef.current.set(selectedOp?.callId ?? "", e.currentTarget.scrollTop);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownView, {
									src: readingSrc,
									baseDir: selected.path.replace(/[\\/][^\\/]*$/, "")
								})
							}) : selected.op.kind === "read" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FileTrace_module_css_default.readContent,
								"data-file-trace-read": true,
								ref: scrollPaneRef,
								onScroll: (e) => {
									scrollMemoryRef.current.set(selectedOp?.callId ?? "", e.currentTarget.scrollTop);
								},
								children: readRows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: FileTrace_module_css_default.readRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FileTrace_module_css_default.lineNo,
										children: String(row.line)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FileTrace_module_css_default.text,
										children: row.nodes
									})]
								}, String(row.line)))
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: FileTrace_module_css_default.diffRows,
								ref: scrollPaneRef,
								onScroll: (e) => {
									scrollMemoryRef.current.set(selectedOp?.callId ?? "", e.currentTarget.scrollTop);
								},
								children: [selected.op.kind === "write" && knownContentBefore(ops, selected.path, selected.op) === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: FileTrace_module_css_default.priorUnknown,
									children: t("diff.priorUnknown")
								}), segments.map((segment, segIndex) => {
									if (segment.kind === "fold") {
										const shouldFold = segment.rows.length >= 3;
										const isExpanded = expandedFolds.has(segIndex);
										if (!shouldFold) return segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`, selectedLang));
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
											children: isExpanded ? segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`, selectedLang)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: FileTrace_module_css_default.foldMarker,
												title: `${t("diff.context")} ${segment.oldStart}–${segment.oldEnd} · ${segment.newStart}–${segment.newEnd}`,
												children: t("diff.fold", { count: String(segment.rows.length) })
											})
										}, `fold-${String(segIndex)}`);
									}
									return segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`, selectedLang));
								})]
							})
						]
					})
				]
			}) }, String(selected?.op.callId ?? "open"))] });
		}
		//#endregion
		//#region src/client/update-chip.ts
		/**
		* Floating update notice for file-trace: mirrors the other plugins' chips —
		* blue when a newer tag exists (click updates via the host endpoint), a
		* transient green confirmation when already current, and a neutral gray
		* retryable notice when the version check cannot reach the network. All
		* `[data-update-chip]` elements stack into one non-overlapping column.
		*/
		const UPDATE_ID = "dsh-file-trace";
		const PACKAGE_SPEC = "@dsh-external/dsh-file-trace";
		const LABEL = "文件追踪";
		let started = false;
		function startUpdateChip() {
			if (started) return;
			started = true;
			fetchLatestTag().then((tag) => {
				if (tag === void 0) {
					renderOfflineChip();
					return;
				}
				if (compareSemver(tag, PLUGIN_VERSION) <= 0) {
					renderCurrentChip(tag);
					return;
				}
				renderChip(tag);
			});
		}
		/** Reflow every visible update chip into a non-overlapping vertical column. */
		function relayout() {
			const chips = Array.from(document.querySelectorAll("[data-update-chip]"));
			let next = 12;
			for (const chip of chips) {
				chip.style.bottom = `${next}px`;
				next += chip.getBoundingClientRect().height + 8;
			}
		}
		function renderChip(tag) {
			if (document.querySelector(`[data-update-chip="${UPDATE_ID}"]`) !== null) return;
			const el = document.createElement("div");
			el.setAttribute("data-update-chip", UPDATE_ID);
			el.setAttribute("role", "button");
			el.setAttribute("title", `更新到 ${tag}`);
			el.style.cssText = "position:fixed;left:12px;z-index:2147483000;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid #4a7dff;border-radius:10px;background:#1e2430;color:#cfe0ff;font:12px/1.4 system-ui,Segoe UI,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35);";
			const label = document.createElement("span");
			label.style.cssText = "pointer-events:none;";
			label.textContent = `⟳ ${LABEL} 新版本 ${tag} 可用，点击更新`;
			const close = document.createElement("button");
			close.textContent = "×";
			close.setAttribute("aria-label", "关闭");
			close.title = "关闭";
			close.style.cssText = "pointer-events:auto;border:0;background:transparent;color:#8fa3c8;font:inherit;cursor:pointer;padding:0 2px;line-height:1;";
			close.addEventListener("click", (event) => {
				event.stopPropagation();
				el.remove();
				relayout();
			});
			el.appendChild(label);
			el.appendChild(close);
			el.addEventListener("pointerdown", (event) => {
				event.stopPropagation();
			});
			el.addEventListener("click", () => {
				label.textContent = "更新中…";
				runUpdate(tag).then((result) => {
					if (result.ok) {
						label.textContent = result.hostChanged === true ? `已更新到 ${tag}（含宿主侧变更），请重启 dsh 生效` : `已更新到 ${tag}，客户端自动刷新生效（未见变化可硬刷新 Ctrl/Cmd+Shift+R）`;
						el.setAttribute("title", "已更新，硬刷新生效");
						return;
					}
					if (result.link) {
						navigator.clipboard?.writeText(updatePrompt(tag)).then(() => {
							label.textContent = `本地 link 安装：已跳过自动更新，更新提示词已复制到剪贴板`;
						}).catch(() => {
							label.textContent = `本地 link：请手动执行 pnpm add '${PACKAGE_SPEC}@github:${MIRROR}#${tag}'`;
						});
						el.setAttribute("title", "悬停查看本地 link 说明");
						return;
					}
					navigator.clipboard?.writeText(updatePrompt(tag)).then(() => {
						label.textContent = `自动更新失败（详见剪贴板提示词）：${result.detail.slice(0, 80)}`;
					}).catch(() => {
						label.textContent = `自动更新失败：${result.detail.slice(0, 80)}`;
					});
					el.setAttribute("title", result.recovery !== void 0 ? `${result.detail}\n恢复命令：${result.recovery}` : result.detail);
				});
			});
			document.body.appendChild(el);
			relayout();
		}
		/** Transient confirmation when the check succeeds and we are already current. */
		function renderCurrentChip(tag) {
			if (document.querySelector(`[data-update-chip="${UPDATE_ID}"]`) !== null) return;
			const el = document.createElement("div");
			el.setAttribute("data-update-chip", UPDATE_ID);
			el.setAttribute("title", "版本检查成功，当前已是最新版本");
			el.style.cssText = "position:fixed;left:12px;z-index:2147483000;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid #2f5d3a;border-radius:10px;background:#1c2a22;color:#9fd8ae;font:12px/1.4 system-ui,Segoe UI,sans-serif;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3);";
			const label = document.createElement("span");
			label.style.cssText = "pointer-events:none;";
			label.textContent = `✓ ${LABEL} 已是最新版本 ${tag}`;
			el.appendChild(label);
			el.addEventListener("pointerdown", (event) => {
				event.stopPropagation();
			});
			el.addEventListener("click", () => {
				el.remove();
				relayout();
			});
			document.body.appendChild(el);
			relayout();
			setTimeout(() => {
				el.remove();
				relayout();
			}, 4e3);
		}
		/** Neutral gray chip shown when the version check cannot reach the network. */
		function renderOfflineChip() {
			if (document.querySelector(`[data-update-chip="${UPDATE_ID}"]`) !== null) return;
			const el = document.createElement("div");
			el.setAttribute("data-update-chip", UPDATE_ID);
			el.setAttribute("title", "无法连接宿主端点 / GitHub 查询新版本（可能是网络不可达）");
			el.style.cssText = "position:fixed;left:12px;z-index:2147483000;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid #4a5060;border-radius:10px;background:#22252c;color:#9aa3b5;font:12px/1.4 system-ui,Segoe UI,sans-serif;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3);";
			const label = document.createElement("span");
			label.style.cssText = "pointer-events:none;";
			label.textContent = `⚠ ${LABEL} 版本检查失败（网络不可达），点击重试`;
			const retry = document.createElement("button");
			retry.textContent = "重试";
			retry.setAttribute("aria-label", "重试版本检查");
			retry.style.cssText = "pointer-events:auto;border:0;background:transparent;color:#8fa3c8;font:inherit;cursor:pointer;padding:0 2px;line-height:1;";
			const close = document.createElement("button");
			close.textContent = "×";
			close.setAttribute("aria-label", "关闭");
			close.title = "关闭";
			close.style.cssText = "pointer-events:auto;border:0;background:transparent;color:#8fa3c8;font:inherit;cursor:pointer;padding:0 2px;line-height:1;";
			close.addEventListener("click", (event) => {
				event.stopPropagation();
				el.remove();
				relayout();
			});
			el.appendChild(label);
			el.appendChild(retry);
			el.appendChild(close);
			let retrying = false;
			const retryOnce = () => {
				if (retrying) return;
				retrying = true;
				label.textContent = "版本检查中…";
				fetchLatestTag().then((tag) => {
					retrying = false;
					if (tag === void 0) {
						label.textContent = `⚠ ${LABEL} 仍无法查询新版本`;
						return;
					}
					el.remove();
					relayout();
					if (compareSemver(tag, PLUGIN_VERSION) > 0) renderChip(tag);
					else renderCurrentChip(tag);
				});
			};
			retry.addEventListener("click", (event) => {
				event.stopPropagation();
				retryOnce();
			});
			el.addEventListener("click", (event) => {
				if (event.target.closest("button") === null) retryOnce();
			});
			document.body.appendChild(el);
			relayout();
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
			"md.read": "阅读",
			"md.raw": "原文",
			"font.min": "已达最小字号 {px}px",
			"font.max": "已达最大字号 {px}px",
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
			"md.read": "Reading",
			"md.raw": "Raw",
			"font.min": "Minimum font size reached ({px}px)",
			"font.max": "Maximum font size reached ({px}px)",
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
				startUpdateChip();
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
