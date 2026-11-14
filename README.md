# 提示词工坊 · dsh-prompt-forge

把一句模糊的生图想法，整理成可直接投喂给图像模型的提示词。插件在 DSH 侧边栏中部的面板区（与「插件」「技能中心」同组）加一个入口，面板里选好目标模型方言、风格、画幅，写一句人话，剩下的交给对话模型——它输出结构化的画面拆解，插件负责拼装成目标模型真正认的语法。

## 安装

**DSH Desktop**：设置 → 插件 → 从 GitHub 安装，粘贴 `https://github.com/Vhow123/dsh-prompt-forge`。

**命令行**（把 `desktop` 换成你实际的 profile 名）：

```sh
dsh plugin --profile desktop add github:Vhow123/dsh-prompt-forge
```

装完重启宿主。侧边栏中部面板区出现「提示词工坊」；插件页里能看到它的 provider 与 model 组件。

## 它解决什么

手写生图提示词有三个反复出现的坑：

1. **糊**：主体、动作、环境、光线、镜头、材质全挤在一句话里，模型只能猜。
2. **废词**：`masterpiece, 8k, ultra detailed, best quality` 这类词对现在的模型不起作用，只会稀释真正的描述。本插件在输出前统一剥掉。
3. **方言不对**：Midjourney 要 `--ar 3:2 --style raw --no ...`，Stable Diffusion 要逗号分隔的 tag 加独立负向词，GPT-Image 要自然语言且**不该**有负向词，nano-banana 要「保持什么、改变什么」的编辑指令。同一段描述换个模型就得重写。

## 六种目标方言

| 方言 | 面向 | 输出形态 |
| --- | --- | --- |
| `natural-en` | 通用英文 | 一段连贯的英文描述 |
| `natural-zh` | 通用中文 | 一段连贯的中文描述 |
| `gpt-image` | GPT-Image 系列 | 自然语言长句，无负向词，无质量词 |
| `midjourney` | Midjourney | 短语串 + `--ar / --style raw / --no`，原有 mj 开关会被剥离后重写 |
| `stable-diffusion` | SD / SDXL / Flux | 逗号 tag 串 + 独立负向提示词 |
| `nano-banana` | Gemini 图像编辑 | 保持/修改分离的编辑指令 |

## 画面拆解

面板右栏永远把结果拆成 11 个字段，每个字段点一下就能单独复制：

`主体 · 动作 · 环境 · 构图 · 光线 · 镜头 · 风格 · 色调 · 材质 · 情绪 · 细节`

这十一个字段同时是模型的输出结构：模型返回 JSON，插件做归一化与拼装兜底，所以模型跑偏时你看到的是缺字段，而不是一段没法用的长文。

## 用法

**面板**：侧边栏中部「提示词工坊」→ 顶部选 provider / model（必须选一次，之后记住）→ 写想法 → `Ctrl+Enter`。右栏可直接改、复制、或从历史里翻回上一次。

**Agent 工具**：对话里直接说「帮我写一个 xx 的生图提示词」，模型会调用 `optimize_image_prompt`。它在没有任何面板打开时也能用，配置从 `~/.dsh/prompt-forge.json` 读。

## 配置

- `~/.dsh/prompt-forge.json`：provider / model / 方言 / 风格 / 语言 / 画幅 / 候选数，`/optimize` 带 `remember: true` 时写入。
- 浏览器 localStorage `dsh-prompt-forge:v1`：面板上的选择与最近 24 条历史。

## 接口

| 路由 | 作用 |
| --- | --- |
| `POST /api/prompt-forge/catalog` | 可用 provider/model 列表 + 方言/风格/模式目录 + 当前配置 |
| `POST /api/prompt-forge/optimize` | 执行一次优化；`runId` 可中途 `/stop` |
| `POST /api/prompt-forge/stop` | 按 runId 取消 |
| `POST /api/prompt-forge/config` | 读/写配置 |

全部只接受本机同源请求。

## 开发

```bash
node --test test/*.test.js      # 引擎与路由单测（23 项）
node test/bare-import.mjs       # 裸加载验证：不重定向任何宿主包直接 import
node --check index.js client.js engine.js
```

`bare-import.mjs` 是本插件必须常驻的回归线：插件用 junction 链接进 profile，真实路径在 DSH 安装目录之外，Node 的 ESM 解析会从真实路径向上找 `node_modules`，够不到 `@deepseek-ai/*`。所以插件**不 import 任何宿主包**，工具定义用自带的 `defineTool` 最小实现（声明式参数表 → JSON Schema + 必填/类型校验），产出对象与宿主 `tools.register()` 期望的形状一致。

加载期诊断会写 `~/.dsh/prompt-forge-load.log`：

```
2026-11-14T09:31:02.114Z module evaluated
2026-11-14T09:31:02.118Z apply() 被调用，webServer=true llm=true
```

有第一行没有第二行，说明模块起来了但没被 apply；两行都没有，说明 bundle 根本没被加载。

## 文件

```
index.js            宿主半：四条路由 + optimize_image_prompt 工具 + 配置持久化
client.js           浏览器半：侧边栏 panellist 图标 + 主区面板 + 拍平词典
engine.js           纯函数引擎：目录、提示词拼装、方言规整、LLM 调用与错误映射
cordis.patch.yml    bundle 补丁：把自己 insert 进插件树
test/               引擎单测 + 裸加载验证
```
