# @dsh-external/dsh-file-trace

DSH Web UI 文件追踪插件：像 Codex 一样记录并查看模型读取/写入/编辑的每一个文件。会话标题栏工具区出现"文件追踪"按钮（带操作数徽标），点击打开右侧抽屉：按文件分组列出全部操作（读取/写入/编辑，含执行中与出错标记），点选任意操作查看逐行 diff——**删除红、新增绿、修改蓝**（经 --dsw 语义令牌着色）。零核心改动，纯浏览器 half 插件。

## 工作原理

- 数据完全来自会话 Chat 视图快照（`views.get('chat').legacy` 的 tool-result 节点与 runningCalls），每次渲染纯派生，无自建状态、无监听器，翻页/刷新自动对齐当前窗口。
- `edit` 工具用模型提供的 old_string/new_string 精确 diff；`write` 用同窗口内上一次已知内容做旧侧（未知则显示为全新增并注明）；`read` 仅记录。
- diff 引擎为行级 LCS（`src/client/diff.ts`），del-run + add-run 重叠对标记为 mod（修改）。
- 注册进 `conversation.session.header.utilities`（session 作用域 list slot，经 `ctx.slots.inject`）。
- 内置兼容性自诊断：DSH 客户端 API 不匹配时渲染修复指引横幅而非崩溃（`src/client/compat.ts`）。

## 版本兼容

- **v0.1.0**：面向 `dsh-v0.1.2-alpha.1`（源码构建安装，不发布 npm）。typecheck、16 个单测、构建全绿。

## 安装（profile 模式）

```sh
git clone <repo>
cd dsh-file-trace && pnpm install && pnpm run build

# 装进 web profile（等价于在 $DSH_HOME/profiles/web 下执行 pnpm add）
dsh plugin --profile web add link:/path/to/dsh-file-trace
```

配置行（`$DSH_HOME/profiles/web/cordis.patch.yml`，热重载）：

```yaml
- insert:
    - id: dsh-file-trace
      name: '@dsh-external/dsh-file-trace'
```

## 已知限制

- 只覆盖当前加载窗口内的操作（与 Chat 视图一致）；翻页加载后自动补全。
- `write` 的旧侧内容来自同窗口更早的 read/write/edit 推断，不在窗口内时显示为全新增。
- 行级 diff；行内（字符级）高亮暂未做。
