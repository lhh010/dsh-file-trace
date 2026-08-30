import { execFile, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
//#region ../test-lhh010/packages/util/home-paths/lib/index.js
/**
* Shared filesystem path helpers for DeepSeek Harness user data.
*
* @module @deepseek-ai/dsh-home-paths
*/
/** Directory name for the default DeepSeek Harness home under the OS home. */
const DSH_HOME_DIR_NAME = ".dsh";
/** Environment variable that overrides the default DeepSeek Harness home. */
const DSH_HOME_ENV = "DSH_HOME";
/**
* Resolve the default DeepSeek Harness home using Node's platform path rules.
* @returns the absolute default harness home path.
*/
function defaultDshHome() {
	return join(homedir(), DSH_HOME_DIR_NAME);
}
/**
* Expand supported tilde prefixes against the operating-system home.
* @param path - configured path that may begin with `~`, `~/`, or `~\`.
* @returns the expanded path, or the original value when no supported prefix is present.
*/
function expandHomePath(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/**
* Resolve the single-root DeepSeek Harness home.
*
* Precedence, highest first: an explicit configured path, `$DSH_HOME`, then
* `~/.dsh`. The harness keeps all user data under one root. An empty or
* whitespace-only `$DSH_HOME` is treated as unset, so a blank override never
* resolves the home to the current working directory.
* @param configured - explicit harness-home override, which has highest precedence.
* @param env - environment mapping used to read `DSH_HOME`.
* @returns the normalized absolute harness home path.
*/
function resolveDshHome(configured, env = process.env) {
	const fromEnv = env[DSH_HOME_ENV];
	return resolve(expandHomePath(configured ?? (fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : defaultDshHome())));
}
/**
* Join path segments onto the resolved DeepSeek Harness home.
* @param segments - path segments appended to the Harness home; an empty list returns the home itself.
* @returns the normalized absolute joined path.
*/
function dshHomePath(...segments) {
	return join(resolveDshHome(), ...segments);
}
//#endregion
//#region src/update-endpoint.ts
/**
* Host-side self-update endpoint for `@dsh-external/dsh-file-trace`.
*
* POST /dsh-file-trace/update  { "tag": "v0.1.4" }
*   Runs the pinned-tag install inside the web profile directory
*   (pnpm add '@dsh-external/dsh-file-trace@github:lhh010/dsh-file-trace#<tag>')
*   and reports the outcome. Only this plugin's own fixed tag is ever
*   installed; the endpoint exists solely for the user-initiated update
*   click in the browser panel.
*/
const UPDATE_PATH = "/dsh-file-trace/update";
const LATEST_PATH = "/dsh-file-trace/latest";
const PACKAGE_SPEC = "@dsh-external/dsh-file-trace";
const MIRROR = "lhh010/dsh-file-trace";
const REPO_GIT = `https://github.com/${MIRROR}.git`;
/** Compare two v-prefixed semvers; >0 when a is newer. */
function semverCompare(a, b) {
	const parse = (v) => {
		const p = v.replace(/^v/, "").split(".").map((x) => Number(x) || 0);
		while (p.length < 3) p.push(0);
		return p;
	};
	const pa = parse(a);
	const pb = parse(b);
	return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}
/** Newest vX.Y.Z tag on the public mirror, via git ls-remote (no auth).
* Async with a hard timeout and a TTL cache: a synchronous execFileSync here
* would block the whole host event loop while the network is unreachable. */
const CACHE_TTL_MS = 3e5;
const GIT_TIMEOUT_MS = 8e3;
let latestCache;
let latestInflight;
function latestFromGit() {
	if (latestCache !== void 0 && Date.now() - latestCache.at < CACHE_TTL_MS) return Promise.resolve(latestCache.latest);
	if (latestInflight !== void 0) return latestInflight;
	latestInflight = new Promise((resolve) => {
		execFile("git", [
			"ls-remote",
			"--tags",
			REPO_GIT
		], {
			encoding: "utf8",
			maxBuffer: 1048576,
			timeout: GIT_TIMEOUT_MS,
			killSignal: "SIGKILL"
		}, (error, stdout) => {
			latestInflight = void 0;
			let latest;
			if (error === null && typeof stdout === "string") for (const line of stdout.split("\n")) {
				const trimmed = line.trim();
				if (trimmed.length === 0) continue;
				const match = trimmed.match(/refs\/tags\/(v\d+\.\d+\.\d+)$/);
				if (match !== null && (latest === void 0 || semverCompare(match[1], latest) > 0)) latest = match[1];
			}
			latestCache = {
				at: Date.now(),
				latest
			};
			resolve(latest);
		});
	});
	return latestInflight;
}
/** True when the installed package is a local link (pnpm stores links as
* symlinks/junctions whose real path differs from the node_modules path).
* A link install must stay local: auto-update would sever it. */
function isLinkInstall() {
	try {
		const p = resolve(dshHomePath("profiles", "web", "node_modules", "@dsh-external"), "dsh-file-trace");
		return realpathSync(p) !== resolve(p);
	} catch {
		return false;
	}
}
/** Run one install command in the profile directory, resolving its exit. */
function runInstall(tag) {
	return new Promise((resolve) => {
		const child = spawn("pnpm", ["add", `${PACKAGE_SPEC}@github:${MIRROR}#${tag}`], {
			cwd: dshHomePath("profiles", "web"),
			shell: true
		});
		let output = "";
		let settled = false;
		const settle = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {}
			settle({
				ok: false,
				output: `${output}安装超时（120s）`
			});
		}, 12e4);
		child.stdout?.on("data", (chunk) => {
			output += chunk.toString();
		});
		child.stderr?.on("data", (chunk) => {
			output += chunk.toString();
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			settle({
				ok: false,
				output: `${output}${String(error)}`
			});
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			settle({
				ok: code === 0,
				output
			});
		});
	});
}
/** Read one JSON request body (bounded). */
function readBody(req) {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk.toString();
			if (body.length > 4096) reject(/* @__PURE__ */ new Error("body too large"));
		});
		req.on("end", () => {
			resolve(body);
		});
	});
}
/**
* Register the update endpoint on the web server (an effect of the host
* plugin's apply, so disposal rides the host fiber).
* @param ctx - host context carrying the webServer service.
*/
function registerUpdateEndpoint(ctx) {
	try {
		registerSafe(ctx);
	} catch (error) {
		ctx.logger?.warn?.(`[dsh-file-trace] update endpoint skipped: ${String(error?.message ?? error)}`);
	}
}
/** Register the routes when ctx.webServer is present. */
function registerSafe(ctx) {
	ctx.effect(() => {
		const latestDispose = ctx.webServer.register({
			kind: "exact",
			path: LATEST_PATH,
			handler: (_req, res) => {
				latestFromGit().then((latest) => {
					const body = `${JSON.stringify({ latest: latest ?? null })}\n`;
					res.writeHead(200, {
						"content-type": "application/json; charset=utf-8",
						"cache-control": "no-store"
					});
					res.end(body);
				});
			}
		});
		const dispose = ctx.webServer.register({
			kind: "exact",
			path: UPDATE_PATH,
			handler: async (req, res) => {
				const send = (status, value) => {
					const body = `${JSON.stringify(value)}\n`;
					res.writeHead(status, {
						"content-type": "application/json; charset=utf-8",
						"cache-control": "no-store"
					});
					res.end(body);
				};
				if (req.method !== "POST") {
					send(405, {
						ok: false,
						error: "method not allowed"
					});
					return;
				}
				try {
					const tag = JSON.parse(await readBody(req)).tag;
					if (typeof tag !== "string" || !/^v\d+\.\d+\.\d+$/.test(tag)) {
						send(400, {
							ok: false,
							error: "invalid tag"
						});
						return;
					}
					if (await isLinkInstall()) {
						send(200, {
							ok: false,
							link: true,
							tag
						});
						return;
					}
					const result = await runInstall(tag);
					send(result.ok ? 200 : 500, {
						ok: result.ok,
						output: result.output.slice(-4e3),
						tag
					});
				} catch (error) {
					send(400, {
						ok: false,
						error: String(error?.message ?? error)
					});
				}
			}
		});
		return () => {
			dispose();
			latestDispose();
		};
	}, "file-trace: update endpoint");
}
//#endregion
//#region src/index.ts
/** Stable Cordis plugin name (matches the manifest id). */
const name = "@dsh-external/dsh-file-trace";
/** The web server is required before the update endpoint can register. */
const inject = ["webServer"];
/**
* Host plugin body: register the update endpoint.
* @param ctx - host context carrying the webServer service.
*/
function apply(ctx) {
	registerUpdateEndpoint(ctx);
}
//#endregion
export { apply, inject, name };
