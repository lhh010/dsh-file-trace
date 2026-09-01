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
  | 'md.raw'
  | 'font.min'
  | 'font.max'
  | 'meta.bytes'

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
  'md.raw': '原文',
  'font.min': '已达最小字号 {px}px',
  'font.max': '已达最大字号 {px}px',
  'meta.bytes': '{bytes}',
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
  'md.raw': 'Raw',
  'font.min': 'Minimum font size reached ({px}px)',
  'font.max': 'Maximum font size reached ({px}px)',
  'meta.bytes': '{bytes}',
}
