# @dsh-external/dsh-file-trace

DSH Web UI 文件追踪插件：像 Codex / Claude Code 一样**记录并查看模型读取、写入、编辑的每一个文件**。会话标题栏工具区出现「文件追踪」按钮（带操作数徽标），点击打开右侧抽屉，按文件分组列出全部操作，点选任意操作查看带行号的内容或**逐行 diff**。零核心改动，纯浏览器 half 插件。

[English](./README.en.md) | **简体中文**

## 功能

- **操作记录**：提取模型对文件的读取 / 写入 / 编辑，含执行中、出错标记、时间与载荷大小。
- **读取视图**：显示被读取文件的**真实内容与真实行号**（剥掉 DSH 读工具响应外壳）。
- **写入视图**：新文件写入显示为**全量新增（每行绿色 +）**；覆盖修改时按真实差异做 del/add。
- **编辑视图（hunk 上下文折叠）**：用窗口内更早的写入/读取内容重建完整文件，保留**变更点 ±3 行上下文**；未变化区域**≥3 行才折叠**成「… N 行」（≤2 行直接显示），点击展开/收起。
- **长行折叠**：单行超过 120 字符自动折叠为省略号，点击展开/收起。
- **终端风格 diff**：等宽字体、行号 gutter、**删除红 / 新增绿 / 修改蓝** 的字体色（背景仅为对应色调弱化，保证可读）。
- **可调高度**：底部 diff 区上方有拖拽把手，可上下拖动调整高度。
- **兼容自诊断**：apply 时探测所需客户端 API，不满足时不崩溃，而是渲染修复指引横幅，提示升级 DSH 或更新插件；组件渲染出错时同样显示修复提示。

## 工作原理

- 数据完全来自会话 Chat 视图快照（`views.get('chat').legacy` 的 tool-result 节点与 runningCalls），并**递归遍历 run_code 等宿主工具的子调用（subCalls）**；每次渲染纯派生，无自建状态、无监听器，刷新/翻页自动对齐当前窗口。
- diff 为行级 LCS；del-run + add-run 重叠对标记为 mod（修改）。
- 注册进 `conversation.session.header.utilities`（session 作用域 list 槽位，经 `ctx.slots.inject`）。

## 安装（profile 模式）

```sh
# 1. 克隆仓库（三个镜像任选其一），构建产物已入库，无需构建
git clone https://github.com/omdsh-dev/dsh-file-trace.git
cd dsh-file-trace && pnpm install

# 2. 装进 web profile（等价于在 $DSH_HOME/profiles/web 下执行 pnpm add）
dsh plugin --profile web add link:/path/to/dsh-file-trace
#   或固定 tag 的 git 依赖：
#   dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:omdsh-dev/dsh-file-trace#v0.1.0'
```

配置行（`$DSH_HOME/profiles/web/cordis.patch.yml`，热重载，无需重启）：

```yaml
- insert:
    - id: dsh-file-trace
      name: '@dsh-external/dsh-file-trace'
```

> 插件需已构建（`pnpm run build` 产出 `lib/client.js`）；克隆的仓库产物已入库，改源码后需重新构建。

## 版本兼容

| 插件版本 | DSH 版本 | 说明 |
| --- | --- | --- |
| `v0.1.0`（默认） | `dsh-v0.1.2-alpha.1` | 首个版本；源码构建安装，不发布 npm。typecheck、20 个单测、构建全绿 |

- 面向 **`dsh-v0.1.2-alpha.1`**（GitHub tag，源码构建安装）。
- 该版本客户端的破坏性重构（`dsh-client-runtime` 移除、`Conversation` 视图化）已在插件内完成适配，并带自诊断横幅兜底。

## 使用说明

1. 会话标题栏右侧工具区点击「文件追踪」。
2. 抽屉按文件分组列出操作（最新在前）；点某个操作：
   - **读取** → 带行号的文件内容；
   - **写入** → 全量新增（绿 +）或真实 del/add；
   - **编辑** → 变更点 ±3 行上下文 + 上下「… N 行」折叠。
3. 长行（>120 字符）点击展开/收起；[⋯ N 行] 点击展开/再次收起。
4. 底部 diff 区上方把手可拖拽调整高度；Esc 或按钮关闭抽屉。

## 已知限制

- 只覆盖当前加载窗口内的操作，并与 Chat 视图一致；翻页加载后自动补全。
- 编辑的"完整文件上下文"依赖窗口内更早的**同一文件**写入/读取内容；若无，则仅显示模型提供的 old_string/new_string 片段。
- 行级 diff；行内（字符级）高亮暂未实现。
- 中英文 README 一致性记录见 `README.i18n.yaml`。
