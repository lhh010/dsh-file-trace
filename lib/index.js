import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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
const PACKAGE_SPEC = "@dsh-external/dsh-file-trace";
const MIRROR = "lhh010/dsh-file-trace";
/** Run one install command in the profile directory, resolving its exit. */
function runInstall(tag) {
	return new Promise((resolve) => {
		const child = spawn("pnpm", ["add", `${PACKAGE_SPEC}@github:${MIRROR}#${tag}`], {
			cwd: dshHomePath("profiles", "web"),
			shell: true
		});
		let output = "";
		child.stdout?.on("data", (chunk) => {
			output += chunk.toString();
		});
		child.stderr?.on("data", (chunk) => {
			output += chunk.toString();
		});
		child.on("error", (error) => {
			resolve({
				ok: false,
				output: `${output}${String(error)}`
			});
		});
		child.on("close", (code) => {
			resolve({
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
	ctx.effect(() => {
		return ctx.webServer.register({
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
