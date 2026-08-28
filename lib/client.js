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
				const content = args.content;
				return typeof content === "string" ? {
					...base,
					content
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
			for (const call of runningCalls) {
				const op = opOfRunning(call);
				if (op !== void 0) ops.push(op);
			}
			for (const node of nodes) {
				if (node.kind !== "tool-result") continue;
				const op = opOfResult(node);
				if (op !== void 0) ops.push(op);
			}
			ops.sort((a, b) => b.time - a.time);
			return ops;
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
		/** Human byte count for the panel meta row. */
		function formatBytes(bytes) {
			if (bytes < 1024) return `${String(bytes)} B`;
			if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / 1048576).toFixed(1)} MB`;
		}
		//#endregion
		//#region \0dsh-css:E:\deepseek-harness\dsh-file-trace\src\client\FileTrace.module.css.mjs
		const css = ".GHGoAa_trigger{border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:8px;align-items:center;gap:6px;padding:0 8px;font-size:12px;line-height:24px;display:inline-flex}.GHGoAa_trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.GHGoAa_badge{background:var(--dsw-alias-state-business-primary);min-width:18px;height:18px;color:var(--dsw-alias-bg-base);border-radius:9px;justify-content:center;align-items:center;padding:0 5px;font-size:11px;display:inline-flex}.GHGoAa_drawer{z-index:1200;background:var(--dsw-alias-bg-base);border-left:1px solid var(--dsw-alias-border-l1);width:min(560px,92vw);box-shadow:var(--dsw-shadow-lv3);flex-direction:column;font-size:13px;display:flex;position:fixed;top:0;bottom:0;right:0}.GHGoAa_drawerHead{border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;gap:10px;padding:12px 14px;display:flex}.GHGoAa_drawerTitle{color:var(--dsw-alias-label-primary);font-weight:600}.GHGoAa_drawerMeta{color:var(--dsw-alias-label-caption);flex:1}.GHGoAa_close{color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:7px;padding:2px 8px}.GHGoAa_close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.GHGoAa_drawerBody{flex:1;padding:8px 10px;overflow-y:auto}.GHGoAa_empty{color:var(--dsw-alias-label-caption);text-align:center;padding:24px 8px}.GHGoAa_fileGroup{margin-bottom:10px}.GHGoAa_filePath{color:var(--dsw-alias-label-secondary);font-family:var(--dsw-mono-font,ui-monospace, monospace);word-break:break-all;padding:2px 4px;font-size:12px;display:block}.GHGoAa_opRow{width:100%;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;text-align:left;background:0 0;border:0;border-radius:8px;align-items:center;gap:8px;padding:4px 6px;font-size:12px;display:flex}.GHGoAa_opRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.GHGoAa_opKind{background:var(--dsw-alias-interactive-bg-muted,var(--dsw-alias-border-l1));border-radius:6px;padding:0 6px;font-size:11px;line-height:18px}.GHGoAa_opKind[data-kind=read]{color:var(--dsw-alias-label-secondary)}.GHGoAa_opKind[data-kind=write]{color:var(--dsw-alias-state-success-primary)}.GHGoAa_opKind[data-kind=edit]{color:var(--dsw-alias-state-business-primary)}.GHGoAa_opTime{color:var(--dsw-alias-label-caption);font-size:11px}.GHGoAa_opFlag{color:var(--dsw-alias-state-business-primary);font-size:11px}.GHGoAa_opFlagError{color:var(--dsw-alias-state-error-primary);font-size:11px}.GHGoAa_opSize{color:var(--dsw-alias-label-caption);margin-left:auto;font-size:11px}.GHGoAa_diffPane{border-top:1px solid var(--dsw-alias-border-l1);flex-direction:column;max-height:55%;display:flex}.GHGoAa_diffHead{border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;gap:8px;padding:8px 14px;display:flex}.GHGoAa_diffPath{font-family:var(--dsw-mono-font,ui-monospace, monospace);word-break:break-all;flex:1;font-size:12px}.GHGoAa_diffRows{font-family:var(--dsw-mono-font,ui-monospace, monospace);padding:4px 0 10px;font-size:12px;overflow-y:auto}.GHGoAa_diffRow{white-space:pre-wrap;word-break:break-all;gap:6px;padding:0 10px;line-height:20px;display:flex}.GHGoAa_lineNo{width:3em;color:var(--dsw-alias-label-caption);text-align:right;user-select:none;flex:none}.GHGoAa_marker{user-select:none;flex:none;width:1em}.GHGoAa_text{flex:1}.GHGoAa_diffRow[data-kind=del] .GHGoAa_marker,.GHGoAa_diffRow[data-kind=del] .GHGoAa_text{color:var(--dsw-alias-state-error-primary)}.GHGoAa_diffRow[data-kind=del]{background:var(--dsw-alias-state-error-secondary)}.GHGoAa_diffRow[data-kind=add] .GHGoAa_marker,.GHGoAa_diffRow[data-kind=add] .GHGoAa_text{color:var(--dsw-alias-state-success-primary)}.GHGoAa_diffRow[data-kind=add]{background:var(--dsw-alias-state-success-secondary)}.GHGoAa_diffRow[data-kind=mod] .GHGoAa_marker,.GHGoAa_diffRow[data-kind=mod] .GHGoAa_text{color:var(--dsw-alias-state-business-primary)}.GHGoAa_diffRow[data-kind=mod]{background:var(--dsw-alias-state-business-tertiary)}.GHGoAa_diffRow[data-kind=context]{color:var(--dsw-alias-label-secondary)}.GHGoAa_priorUnknown{color:var(--dsw-alias-label-caption);padding:4px 14px;font-size:11px}";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"@dsh-external/dsh-file-trace/FileTrace.module.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dsh-external/dsh-file-trace";
			tag.dataset.pluginCss = "@dsh-external/dsh-file-trace/FileTrace.module.css";
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var FileTrace_module_css_default = {
			"opSize": "GHGoAa_opSize",
			"drawerHead": "GHGoAa_drawerHead",
			"drawerMeta": "GHGoAa_drawerMeta",
			"close": "GHGoAa_close",
			"badge": "GHGoAa_badge",
			"drawerBody": "GHGoAa_drawerBody",
			"opKind": "GHGoAa_opKind",
			"diffRows": "GHGoAa_diffRows",
			"diffRow": "GHGoAa_diffRow",
			"lineNo": "GHGoAa_lineNo",
			"marker": "GHGoAa_marker",
			"opFlag": "GHGoAa_opFlag",
			"diffPath": "GHGoAa_diffPath",
			"text": "GHGoAa_text",
			"priorUnknown": "GHGoAa_priorUnknown",
			"fileGroup": "GHGoAa_fileGroup",
			"filePath": "GHGoAa_filePath",
			"trigger": "GHGoAa_trigger",
			"drawer": "GHGoAa_drawer",
			"opTime": "GHGoAa_opTime",
			"drawerTitle": "GHGoAa_drawerTitle",
			"empty": "GHGoAa_empty",
			"opFlagError": "GHGoAa_opFlagError",
			"diffPane": "GHGoAa_diffPane",
			"opRow": "GHGoAa_opRow",
			"diffHead": "GHGoAa_diffHead"
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
		/** Diff material for one operation, computed at open time. */
		function diffOf(op, prior) {
			if (op.kind === "read") return [];
			if (op.kind === "edit" && op.edit !== void 0) return diffLines(op.edit.oldString, op.edit.newString);
			if (op.kind === "write" && op.content !== void 0) return diffLines(prior ?? "", op.content);
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
			const [selected, setSelected] = (0, react.useState)(null);
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
				role: "dialog",
				"aria-label": t("title"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: FileTrace_module_css_default.drawerHead,
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
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: FileTrace_module_css_default.diffRows,
							children: [selected.op.kind === "write" && knownContentBefore(ops, selected.path, selected.op) === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FileTrace_module_css_default.priorUnknown,
								children: t("diff.priorUnknown")
							}), diffRows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: FileTrace_module_css_default.diffRow,
								"data-kind": row.kind,
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
										className: FileTrace_module_css_default.marker,
										"aria-label": t(`diff.${row.kind}`),
										children: row.kind === "del" ? "-" : row.kind === "add" ? "+" : row.kind === "mod" ? "~" : " "
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FileTrace_module_css_default.text,
										children: row.text
									})
								]
							}, String(index)))]
						})]
					})
				]
			})] });
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
			"meta.bytes": "{bytes}"
		};
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
