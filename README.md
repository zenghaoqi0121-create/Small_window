# 拾窗 0.2.0

Windows DeepSeek Harness 的截图对话浮窗，包含配套 Skill 与本地窗口组件。沿用 Harness 原会话的模型、账号和上下文，不需要另配模型 API。

## 当前进度（2026-10-26）

0.2.0 已完成直接发送、浮窗回复同步、固定会话、持续追问和停止生成功能，并生成本地安装包。35 项 Node 测试、7 项原生自检及不连接模型的本地窗口测试通过。真实 Harness 与模型的端到端联调仍待完成，详见 [验证记录](docs/VALIDATION.md) 和 [更新记录](docs/CHANGELOG.md)。

本次交付保留当前已安装的 Harness 插件。更新 GitHub 源码不会自动替换 Harness 正在加载的副本；安装新版需按下文重新构建并更新插件来源。

## 使用

1. 在 Harness 选中一个已有会话，点击输入框旁的「截图提问」。
2. 在浮窗点「区域截图」，拖动选区；也可以只输入文字。
3. 点「发送」或按 Ctrl+Enter，消息直接进入原会话。截图的问题选填，不填时发送「请分析这张截图。」；图片和文字都没有时不会发送。
4. 浮窗显示原会话最近 20 条用户/助手消息，回答实时更新，可以继续追问。「停止生成」会请求停止该会话当前的回答；已排队消息由 Harness 继续管理。

Alt+Space 隐藏或唤起浮窗；被占用时降级 Ctrl+Alt+Space，实际按键显示在右上角。Esc 和关闭按钮只隐藏，保留输入和回答。Harness 必须保持运行。成功发送后才清空本次截图与输入，失败或结果未确认时保留内容，且不会自动重发。

浮窗固定到原会话，主窗口切换或最小化不会改变它。要更换目标，从主窗口另一个会话点击「截图提问」；如浮窗还有未发送内容，先发送或清空。浮窗不会读取、修改或顺带提交主窗口尚未发送的草稿和附件。

回复以可复制的文本显示，保留换行和代码原文。历史图片与文件显示为文本标记。向上浏览或选择文字时，流式更新不会强制滚动到底部。复杂 Markdown、工具卡片、OCR、标注与 ChatGPT 适配尚未加入；视觉样式待后续草图调整。

## 安装与更新

目标宿主为 Windows Harness 0.2.1-rc.2。使用支持图片的模型发送截图；不支持时会提示失败。

在 Harness 的「插件」页面添加本地压缩包的绝对路径，例如：

`D:\chatgpt工作区\小窗插件制作\dist\dsh-shichuang-0.2.0.tgz`

已安装 0.1.0 的用户需用新版包替换原插件来源，按宿主提示重载插件或重启 Harness。不要同时启用两个同名拾窗插件。当前测试来源若是 `D:\deepseek工作区\Small_window`，仅更新另一个开发目录不会自动更新该安装来源。

本地路径和压缩包安装方式见 [Harness 插件管理说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.zh.md)。单独复制 Skill 文件无法提供窗口或系统快捷键。

## 开发与验证

需要 Windows、Node.js 22+ 和 Windows 自带的 .NET Framework 4 编译器。项目没有外部 npm 运行依赖。

```powershell
npm run check
New-Item -ItemType Directory -Path dist -Force
npm pack --pack-destination dist
```

`npm run check` 先构建客户端、编译原生组件并运行自检，再运行 Node 测试。验证范围及真实宿主联调结果见 [验证记录](docs/VALIDATION.md)。`node scripts/native-probe.mjs` 启动不连接模型的本地 UI 测试；在启动终端输入 `quit` 退出。

截图只通过本机桥接提交到绑定会话，提交确认后清理桥接图片；主窗口与模型的消息存储仍由 Harness 管理。回复同步使用独立会话订阅，断线只恢复同步，不自动重复提问。停用插件时释放订阅并退出其本地组件。

设计与范围见 [MVP 说明](docs/MVP.md)，版本变化见 [更新记录](docs/CHANGELOG.md)。Skill 位于 `skills/screen-question/SKILL.md`。
