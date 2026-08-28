//#region src/invariant.ts
const PACKAGE_NAME = "@dsh-external/dsh-file-trace";
/** Cordis companion plugin name. */
const name = "dsh-file-trace-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the trace panel derives entirely from the Chat view
* snapshot through framework hooks; the host side has no runtime state.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns The installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
