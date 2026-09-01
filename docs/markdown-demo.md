# 一级大标题 H1

## 二级标题 H2

### 三级标题 H3

#### 四级标题 H4

普通段落文本，包含 **加粗**、__下划线式加粗__、*斜体*、_下划线式斜体_、***粗斜体***、~~删除线~~、`行内代码`、以及 [一个链接](https://example.com)。

---

## 列表

无序列表：
- 项目一
- 项目二
  - 嵌套项目 2.1
  - 嵌套项目 2.2
- 项目三

有序列表：
1. 第一步
2. 第二步
3. 第三步

任务列表：
- [x] 已完成事项
- [ ] 待办事项

---

## 引用

> 这是一段引用文字。
>
> 引用可以有多个段落，Markdown 里用 > 开头。

> 嵌套引用：
>> 这是二级嵌套引用。

---

## 表格

| 帧名 | 文件 | 说明 | 数量 |
|:---:|------|------|:---:|
| 眨眼 | `眨眼.txt` | 两眼闭合 | 1 |
| 喷水花 | `喷水花1.txt` ~ `喷水花6.txt` | 水花从喷起到散开 | 6 |
| 摆尾巴 | `摆尾巴1.txt` ~ `摆尾巴4.txt` | 尾鳍右摆 | 4 |
| 睡觉 | `睡觉1.txt` ~ `睡觉5.txt` | Z 符号上浮淡出 | 5 |

---

## 代码块

行内代码：`python whale_tools.py restore standard`。

Python 代码块：

```python
def hello(name: str) -> str:
    """示例函数"""
    return f"Hello, {name}!"

print(hello("whale"))
```

Shell 代码块：

```bash
python whale_tools.py 摆尾巴3
```

---

## 图片

绝对路径引用的像素鲸鱼 PNG（standard 帧）：

![标准帧像素鲸鱼](E:\deepseek-harness\whale_frames\pixel_images\standard.png)

GIF 动图（摆尾巴）：

![摆尾巴 GIF](E:\deepseek-harness\whale_frames\摆尾巴.gif)

GIF 动图（喷水花）：

![喷水花 GIF](E:\deepseek-harness\whale_frames\喷水花.gif)

### HTML img 标签写法

<img src="E:\deepseek-harness\whale_frames\pixel_images\眨眼.png" width="400" alt="眨眼帧"/>

---

## 文件链接

- 源 Excel：[`whale.xlsx`](E:\deepseek-harness\whale_frames\whale.xlsx)
- 导出脚本：[`whale_tools.py`](E:\deepseek-harness\whale_frames\whale_tools.py)
- 说明文档：[`README.md`](E:\deepseek-harness\whale_frames\README.md)
- 矩阵文件：[`动腹鳍1.txt`](E:\deepseek-harness\whale_frames\动腹鳍1.txt)

---

## 其他语法

脚注示例[^1]。

[^1]: 这是脚注的内容。

转义字符：\* 不是斜体\*，\# 不是标题。

长横线另一种写法：

***

自动链接：<https://example.com>

键值对表格之外的用法 —— 术语表：

术语 A
: 定义 A 的内容

术语 B
: 定义 B 的内容

数学公式（部分渲染器支持）：

$a^2 + b^2 = c^2$

$$E = mc^2$$

---

*文档结束。*