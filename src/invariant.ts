/**
 * Package-owned invariant companion for '@dsh-external/dsh-file-trace'.
 * @module @dsh-external/dsh-file-trace/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-external/dsh-file-trace'

/** Cordis companion plugin name. */
export const name = 'dsh-file-trace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the trace panel derives entirely from the Chat view
 * snapshot through framework hooks; the host side has no runtime state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
