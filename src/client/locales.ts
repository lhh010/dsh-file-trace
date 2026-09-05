/** File-trace panel copy: zh default, en mirror. */
export type FileTraceKey =
  | 'title'
  | 'open'
  | 'close'
  | 'empty'
  | 'files'
  | 'ops.read'
  | 'ops.write'
  | 'ops.edit'
  | 'running'
  | 'error'
  | 'diff.old'
  | 'diff.new'
  | 'diff.context'
  | 'diff.del'
  | 'diff.add'
  | 'diff.mod'
  | 'diff.priorUnknown'
  | 'diff.fold'
  | 'md.read'
  | 'html.render'
  | 'html.raw'
  | 'html.sandbox.strict'
  | 'html.sandbox.script'
  | 'html.sandbox.relaxed'
  | 'md.raw'
  | 'font.min'
  | 'font.max'
  | 'meta.bytes'
  | 'redact.on'
  | 'redact.off'
  | 'redact.onLabel'
  | 'redact.offLabel'
  | 'redact.banner'
  | 'read.partial'
  | 'read.stitched'
  | 'stitch.do'
  | 'stitch.on'

export const zh: Record<FileTraceKey, string> = {
  title: '文件追踪',
  open: '查看本会话文件变更',
  close: '关闭',
  empty: '本会话窗口内还没有文件操作',
  files: '个文件',
  'ops.read': '读取',
  'ops.write': '写入',
  'ops.edit': '编辑',
  running: '执行中',
  error: '出错',
  'diff.old': '旧',
  'diff.new': '新',
  'diff.context': '上下文',
  'diff.del': '删除',
  'diff.add': '新增',
  'diff.mod': '修改',
  'diff.priorUnknown': '（变更前的内容不在当前窗口，显示为全新增）',
  'diff.fold': '{count} 行…点击展开',
  'md.read': '阅读',
  'html.render': '渲染',
  'html.raw': '原文',
  'html.sandbox.strict': '沙箱·受限',
  'html.sandbox.script': '沙箱·脚本',
  'html.sandbox.relaxed': '沙箱·宽松',
  'md.raw': '原文',
  'font.min': '已达最小字号 {px}px',
  'font.max': '已达最大字号 {px}px',
  'meta.bytes': '{bytes}',
  'redact.on': '已开启脱敏：敏感内容以 [REDACTED] 显示；点击关闭（自担风险）',
  'redact.off': '脱敏已关闭：将原样显示文件内容；点击开启',
  'redact.onLabel': '脱敏中',
  'redact.offLabel': '脱敏关',
  'redact.banner': '已脱敏',
  'read.partial': '读取被截断（仅第 {range} 行）——预览显示的是不完整文档',
  'read.stitched': '已拼合 {count} 段分段读取（第 {range} 行）',
  'stitch.do': '拼合分段读取',
  'stitch.on': '分段已拼合',
}

export const en: Record<FileTraceKey, string> = {
  title: 'File trace',
  open: 'Review file changes in this session',
  close: 'Close',
  empty: 'No file operations in the loaded window yet',
  files: 'files',
  'ops.read': 'Read',
  'ops.write': 'Write',
  'ops.edit': 'Edit',
  running: 'running',
  error: 'error',
  'diff.old': 'old',
  'diff.new': 'new',
  'diff.context': 'context',
  'diff.del': 'deleted',
  'diff.add': 'added',
  'diff.mod': 'modified',
  'diff.priorUnknown': '(prior content outside the loaded window; shown all-added)',
  'diff.fold': '{count} lines…click to expand',
  'md.read': 'Reading',
  'html.render': 'Render',
  'html.raw': 'Raw',
  'html.sandbox.strict': 'Sandbox·strict',
  'html.sandbox.script': 'Sandbox·script',
  'html.sandbox.relaxed': 'Sandbox·relaxed',
  'md.raw': 'Raw',
  'font.min': 'Minimum font size reached ({px}px)',
  'font.max': 'Maximum font size reached ({px}px)',
  'meta.bytes': '{bytes}',
  'redact.on': 'Redaction on: secrets render as [REDACTED]; click to disable (at your own risk)',
  'redact.off': 'Redaction off: file content renders verbatim; click to enable',
  'redact.onLabel': 'Redacting',
  'redact.offLabel': 'Redaction off',
  'redact.banner': 'Redacted',
  'read.partial': 'Partial read (lines {range} only) — the preview shows an incomplete document',
  'read.stitched': 'Stitched {count} segment reads (lines {range})',
  'stitch.do': 'Stitch segment reads',
  'stitch.on': 'Segments stitched',
}