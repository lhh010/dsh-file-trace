# @dsh-external/dsh-file-trace

DSH Web UI 文件追踪插件：像 Codex / Claude Code 一样**记录并查看模型读取、写入、编辑的每一个文件**。会话标题栏工具区出现「文件追踪」按钮（带操作数徽标），点击打开浮动窗口，按文件分组列出全部操作，点选任意操作查看带行号的内容或**逐行 diff**。零核心改动，纯浏览器 half 插件。

[English](./README.en.md) | **简体中文**

## 安装（profile 模式）

```sh
# 方式一：git 依赖固定 tag（公开镜像，推荐；也可用 github:omdsh-dev/dsh-file-trace）
dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:omdsh-dev/dsh-file-trace#v0.1.7'

# 方式二：本地 link（开发；克隆的仓库构建产物已入库，改源码后需 pnpm run build）
git clone https://github.com/omdsh-dev/dsh-file-trace.git
cd dsh-file-trace && pnpm install
dsh plugin --profile web add link:/path/to/dsh-file-trace
```

配置行（`$DSH_HOME/profiles/web/cordis.patch.yml`，热重载，无需重启）：

```yaml
- insert:
    - id: dsh-file-trace
      name: '@dsh-external/dsh-file-trace'
```

> **安装提示**：pnpm 11 首次安装可能拦截 node-pty 等构建脚本——在 `~/.dsh/profiles/web` 下执行 `pnpm approve-builds --all` 放行后重跑安装命令；装完**硬刷新浏览器**（Ctrl/Cmd+Shift+R）。

### 提示词安装（让 DSH 自己装）

把下面这段提示词发给任意一个 DSH 会话，模型会替你完成安装：

> 帮我安装 dsh-file-trace 插件（DSH 文件追踪：记录并查看模型读写编辑的文件与 diff），步骤：
> 1. 执行 `dsh plugin --profile web add '@dsh-external/dsh-file-trace@github:omdsh-dev/dsh-file-trace#v0.1.7'`（首次可能被 pnpm 11 拦截 node-pty 构建脚本而失败）
> 2. 在 `~/.dsh/profiles/web` 下执行 `pnpm approve-builds --all`（放行构建脚本）
> 3. 再执行一次第 1 步的安装命令
> 4. 完成后在 `~/.dsh/profiles/web/cordis.patch.yml` 追加 - insert 插件行（id: dsh-file-trace，name: '@dsh-external/dsh-file-trace'），并提醒我硬刷新浏览器（Ctrl/Cmd+Shift+R）
> 遇到报错先查 https://github.com/omdsh-dev/dsh-file-trace README 的已知限制。

## 功能

- **操作记录**：提取模型对文件的读取 / 写入 / 编辑，含执行中、出错标记、时间与载荷大小（递归覆盖 run_code 等宿主工具的子调用）。
- **读取视图**：显示被读取文件的**真实内容与真实行号**（剥掉 DSH 读工具响应外壳）。
- **出错统一展示**：读取 / 写入 / 编辑**失败**的操作点开即显示结果里的真实错误文本（红色错误块），不再渲染伪造 diff。
- **语法高亮**：按扩展名识别常见语言（C/C++、Java、C#、JS/TS、Python、Go、Rust、cmd/batch、PowerShell、JSON/YAML/TOML、SQL 等），读取视图与 diff 行的**关键字 / 字符串 / 数字 / 类型 / 函数 / 注释 / 预处理指令**分别着色；修改行的行内变更底色与着色叠加。
- **写入视图**：新文件写入显示为**全量新增（每行绿色 +）**；覆盖修改时按真实差异做 del/add。
- **编辑视图（hunk 上下文折叠）**：用窗口内更早的写入/读取内容重建完整文件，保留**变更点 ±3 行上下文**；未变化区域**≥3 行才折叠**成「… N 行」（≤2 行直接显示），点击展开/收起。
- **长行折叠**：单行超过 120 字符自动折叠为省略号，点击展开/收起。
- **终端风格 diff**：等宽字体、行号 gutter、**删除红 / 新增绿 / 修改蓝** 的字体色（背景仅为对应色调弱化，保证可读）。
- **浮动窗口（可拖拽 / 可调大小 / 右侧吸附）**：拖动标题栏移动位置，拖左缘/底缘调整宽高（位置与尺寸持久化到 localStorage）；**拖到屏幕右缘释放自动吸附为全高右侧栏，主对话区同步右移避让不重叠，再拖标题栏即脱离**；底部 diff 区上方另有把手调整列表与 diff 的分配。
- **兼容自诊断**：apply 时探测所需客户端 API，不满足时不崩溃，而是渲染修复指引横幅；组件渲染出错时同样显示修复提示。

## 工作原理

- 数据完全来自会话 Chat 视图快照（`views.get('chat').legacy` 的 tool-result 节点与 runningCalls），每次渲染纯派生，无自建状态、无监听器，刷新/翻页自动对齐当前窗口。
- diff 为行级 LCS；del-run + add-run 重叠对标记为 mod（修改）。
- 注册进 `conversation.session.header.utilities`（session 作用域 list 槽位，经 `ctx.slots.inject`）。

## 版本兼容

| 插件版本 | DSH 版本 | 说明 |
| --- | --- | --- |
| `v0.1.7`（默认） | `dsh-v0.1.2-alpha.1` | 语法高亮（含跨行块注释）；出错统一展示真实错误文本；折叠展开对齐修复；版本号随 tag | 
| `v0.1.6` | `dsh-v0.1.2-alpha.1` | 版本检查走宿主同源端点；滚动位置记忆 | 
| `v0.1.4` | `dsh-v0.1.2-alpha.1` | 自动版本检查 + 点击更新 |
| `v0.1.3` | `dsh-v0.1.2-alpha.1` | 右缘吸附为右侧栏 + 主对话避让；typecheck、20 个单测、构建全绿 |
| `v0.1.2` | `dsh-v0.1.2-alpha.1` | 浮动窗口化（拖拽/调宽高/持久化） |
| `v0.1.1` | `dsh-v0.1.2-alpha.1` | hunk 折叠阈值 ≥3 行；读取出错红色展示；渲染错误边界 |
| `v0.1.0` | `dsh-v0.1.2-alpha.1` | 首个版本；源码构建安装，不发布 npm |

- 面向 **`dsh-v0.1.2-alpha.1`**（GitHub tag，源码构建安装）。
- 该版本客户端的破坏性重构（`dsh-client-runtime` 移除、`Conversation` 视图化）已在插件内完成适配，并带自诊断横幅兜底。

## 使用说明

1. 会话标题栏右侧工具区点击「文件追踪」。
2. 窗口按文件分组列出操作（最新在前）；点某个操作：
   - **读取** → 带行号的文件内容（出错为红色错误块）；
   - **写入** → 全量新增（绿 +）或真实 del/add；
   - **编辑** → 变更点 ±3 行上下文 + 上下「… N 行」折叠。
3. 长行（>120 字符）点击展开/收起；「… N 行」点击展开/再次收起。
4. 拖标题栏移动窗口；拖到**屏幕右缘**松手即吸附为右侧栏（主对话自动避让），再拖即脱离；拖左缘/底缘调宽高。
5. Esc 或按钮关闭窗口。

## 已知限制

- 只覆盖当前加载窗口内的操作，并与 Chat 视图一致；翻页加载后自动补全。
- 编辑的"完整文件上下文"依赖窗口内更早的**同一文件**写入/读取内容；若无，则仅显示模型提供的 old_string/new_string 片段。
- 行级 diff + 行内字符级高亮；语法高亮为轻量正则分词（无语法树），多行块注释状态按行序推导、跨行正确着色，复杂构造可能不完全精确。
- 中英文 README 一致性记录见 `README.i18n.yaml`。
