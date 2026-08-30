/**
 * Pure extraction of file operations from the Chat view's tool material:
 * settled tool-result nodes plus in-flight running calls. Each op records the
 * tool kind (read/write/edit), the target path, the exact payload available
 * for diffing, and enough identity to key a list row. No React, no DOM.
 */
import type {
  ConversationNode, RunningToolCall, ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The file-touching operation kinds this tracer distinguishes. */
export type FileOpKind = 'read' | 'write' | 'edit'

/** One extracted file operation. */
export interface FileOp {
  /** Stable row key: the originating call id. */
  readonly callId: string
  readonly kind: FileOpKind
  /** Workspace-relative or absolute path exactly as the model spelled it. */
  readonly path: string
  /** Unix epoch ms of the call; the result time when only that is known. */
  readonly time: number
  /** True while the call is still running (no result yet). */
  readonly running: boolean
  /** True when the result reported an error. */
  readonly isError: boolean
  /** The result's error text when isError; presented instead of the payload. */
  readonly errorText?: string
  /** For 'edit': the model's exact replacement payload. */
  readonly edit?: { oldString: string; newString: string }
  /** For 'write': the full new content. */
  readonly content?: string
  /** For 'read': the file content returned by the tool result. */
  readonly read?: string
}

/** Tool names mapped to each op kind; unknown names are ignored. */
const READ_TOOLS = new Set(['read', 'view', 'see'])
const WRITE_TOOLS = new Set(['write', 'create'])
const EDIT_TOOLS = new Set(['edit', 'str_replace', 'str-replace-editor', 'multi-edit'])

/** Classify one tool name; undefined when the tool touches no file. */
function kindOf(name: string): FileOpKind | undefined {
  if (READ_TOOLS.has(name)) return 'read'
  if (WRITE_TOOLS.has(name)) return 'write'
  if (EDIT_TOOLS.has(name)) return 'edit'
  return undefined
}

/**
 * Parse one raw tool-call arguments JSON body defensively: the payload is
 * model-emitted wire data, so every field is checked before use.
 */
function parseArgs(argsRaw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Extract the path field common to every file tool's arguments. */
function pathOf(args: Record<string, unknown>): string | undefined {
  for (const key of ['file_path', 'path', 'filePath']) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** Join a result's text blocks into one string. */
function joinText(content: ReadonlyArray<object>): string {
  return content
    .map((block) => {
      if (!('text' in block)) return ''
      const text: unknown = block.text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

/** Extract one settled tool-result node when it touches a file. */
function opOfResult(node: ToolResultNode): FileOp | undefined {
  if (node.call === null) return undefined
  const kind = kindOf(node.call.name)
  if (kind === undefined) return undefined
  const args = parseArgs(node.call.argsRaw)
  const path = pathOf(args)
  if (path === undefined) return undefined
  const errorText = node.isError ? joinText(node.content) : undefined
  const base = {
    callId: node.callId,
    kind,
    path,
    time: node.callTime ?? node.time,
    running: false,
    isError: node.isError,
    ...(errorText !== undefined && errorText.length > 0 ? { errorText } : {}),
  }
  if (kind === 'edit') {
    const oldString = args.old_string
    const newString = args.new_string
    return typeof oldString === 'string' && typeof newString === 'string'
      ? { ...base, edit: { oldString, newString } }
      : base
  }
  if (kind === 'write') {
    const fromArgs = args.content
    // Fall back to the result content block when the args payload omits it.
    const fromResult = joinText(node.content)
    const content = typeof fromArgs === 'string' && fromArgs.length > 0 ? fromArgs : fromResult
    return content.length > 0 ? { ...base, content } : base
  }
  if (kind === 'read') {
    // The read tool returns the file content as text blocks; join them.
    const text = joinText(node.content)
    return text.length > 0 ? { ...base, read: text } : base
  }
  return base
}

/** Extract one in-flight running call when it touches a file. */
function opOfRunning(call: RunningToolCall): FileOp | undefined {
  const kind = kindOf(call.name)
  if (kind === undefined) return undefined
  const args = parseArgs(call.argsRaw)
  const path = pathOf(args)
  if (path === undefined) return undefined
  return { callId: call.callId, kind, path, time: call.time, running: true, isError: false }
}

/**
 * All file operations in the loaded window, newest first. Running calls come
 * first (they are the live edge), settled results follow by time descending.
 * @param nodes - the Chat view's legacy node slice.
 * @param runningCalls - the Chat view's legacy in-flight calls.
 * @returns the ordered operation list.
 */
export function extractFileOps(
  nodes: readonly ConversationNode[],
  runningCalls: readonly RunningToolCall[],
): FileOp[] {
  const ops: FileOp[] = []
  // File tools dispatched through a host tool such as run_code are recorded as
  // *child* calls (subCalls) nested under the parent tool-result node, so the
  // collector recurses: top-level running calls and every tool-result node
  // (whether directly visible or a descendant of a parent call).
  for (const call of runningCalls) {
    collectFromBlocks([call], ops)
  }
  for (const node of nodes) {
    if (node.kind !== 'tool-result') continue
    collectFromBlocks([node], ops)
  }
  ops.sort((a, b) => b.time - a.time)
  return ops
}

/** Recursively collect file operations from a block list (parent or descendant). */
function collectFromBlocks(blocks: readonly (RunningToolCall | ToolResultNode)[], out: FileOp[]): void {
  for (const block of blocks) {
    const op = 'call' in block ? opOfResult(block) : opOfRunning(block)
    if (op !== undefined) out.push(op)
    if (block.subCalls.length > 0) collectFromBlocks(block.subCalls, out)
  }
}

/**
 * Group operations by path, newest op first per file, files ordered by their
 * most recent operation.
 * @param ops - the flat operation list.
 * @returns file path to its operations (newest first within each file).
 */
export function groupByFile(ops: readonly FileOp[]): Map<string, FileOp[]> {
  const groups = new Map<string, FileOp[]>()
  for (const op of ops) {
    const list = groups.get(op.path) ?? []
    list.push(op)
    groups.set(op.path, list)
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1][0]!.time - a[1][0]!.time)
  return new Map(ordered)
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
export function knownContentBefore(ops: readonly FileOp[], path: string, before: FileOp): string | undefined {
  const ofFile = ops.filter(op => op.path === path && op.time <= before.time && op !== before)
  for (let i = ofFile.length - 1; i >= 0; i -= 1) {
    const op = ofFile[i]!
    if (op.kind === 'write' && op.content !== undefined) return op.content
    if (op.kind === 'edit' && op.edit !== undefined && i === ofFile.length - 1) {
      // The edit's old side is authoritative only for the immediately
      // preceding state; earlier reconstruction is not attempted.
      return op.edit.oldString
    }
  }
  return undefined
}

/**
 * Strip the DSH read-tool response envelope from a read result so the panel
 * shows only the file content: drop the <path>/<type>/<content> wrapper, the
 * "(Showing lines ...)" note, and the per-line "<n>: " number prefixes. Falls
 * back to the raw text when no <content> section is present.
 */
export function parseReadContent(raw: string): string {
  const contentMatch = raw.match(/<content>([\s\S]*?)<\/content>/)
  const body = contentMatch ? contentMatch[1]! : raw
  return body
    .split('\n')
    .filter((line) => !/^\s*\(Showing lines .*\)\s*$/.test(line))
    .map((line) => line.replace(/^\s*\d+:\s/, ''))
    .join('\n')
    .replace(/\n+$/, '')
}

/** One parsed read line: the file's own line number and its content text. */
export interface ReadLine { readonly line: number; readonly text: string }

/**
 * Parse a DSH read result into file lines with their real line numbers.
 * Drops the <content> envelope and "(Showing lines ...)" note; recovers the
 * "<n>: " prefix as the line number, falling back to sequential counting when
 * a line has no prefix.
 * @param raw - the read tool result text.
 * @returns ordered file lines.
 */
export function parseReadLines(raw: string): ReadLine[] {
  const contentMatch = raw.match(/<content>([\s\S]*?)<\/content>/)
  const body = contentMatch ? contentMatch[1]! : raw
  const result: ReadLine[] = []
  let fallback = 1
  for (const line of body.split('\n')) {
    if (/^\s*\(Showing lines .*\)\s*$/.test(line)) continue
    if (line.length === 0) continue
    const match = line.match(/^\s*(\d+):\s?(.*)$/)
    if (match !== null) {
      result.push({ line: Number(match[1]), text: match[2] ?? '' })
      fallback = Number(match[1]) + 1
    } else {
      result.push({ line: fallback, text: line })
      fallback += 1
    }
  }
  return result
}


