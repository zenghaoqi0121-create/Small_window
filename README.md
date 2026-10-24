# 拾窗

Windows DeepSeek Harness 的截图提问插件，包含配套 Skill 与本地小窗组件。目标版本为已安装的 Harness **0.2.1-rc.2**。

## MVP 用法

1. 在 Harness 选中一个已有会话。
2. 按 **Alt+Space**，或点击输入框旁的「截图提问」。快捷键被占用时尝试 **Ctrl+Alt+Space**，实际按键显示在小窗右上角。
3. 点击「区域截图」，拖动选区。Esc 或右键取消截图，保留旧图。
4. 填写问题，点击「放入会话」或按 Ctrl+Enter。
5. 回到原会话，检查图片和草稿后发送。回复显示在原会话中，使用该会话已有的模型配置。

Esc 隐藏小窗并保留内容。「清空」会放弃当前小窗内容。单次截图限 PNG 8MB，问题最多 12000 字。打开时固定目标会话；切换会话后需回到原会话接收。原有草稿不会被覆盖，问题插入到原输入位置。

Harness 必须保持运行，且当前模型需要支持图片。首版没有 OCR、标注、小窗回复流、开机自启或 ChatGPT 适配。单独复制 `SKILL.md` 不能提供截图与系统快捷键。

## 构建与安装

需要 Windows、Node.js 22+ 和 Windows 自带的 .NET Framework 4 编译器；项目无外部 npm 依赖。

```powershell
npm run check
npm pack --pack-destination dist
```

在 Harness 的「插件」页面添加本地压缩包的绝对路径，例如 `D:\chatgpt工作区\小窗插件制作\dist\dsh-shichuang-0.1.0.tgz`，按宿主提示启用或重启。卸载同样使用 Harness 插件页。开发时也可从插件页添加本项目的绝对目录路径。

本地路径和压缩包安装方式参考 [Harness 插件管理说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.zh.md)。本项目不会改写 Harness 安装文件或代改用户的 desktop profile。

## 验证范围

`npm run check` 包括逻辑测试、客户端构建、Windows 组件编译与原生自检。逻辑测试覆盖目标会话固定、过期清理、回环认证、附件失败回滚、旧草稿保留和接收确认。它们不等于已经在真实 Harness 会话内完成端到端验证；现场联调结果记录在 `docs/VALIDATION.md`。

截图和问题在插件桥接队列中仅保留于内存，收到确认后清理；未接收内容十分钟过期。它们随后成为 Harness 的原生草稿，发送、历史和模型处理遵循 Harness 的原有行为。禁用插件时退出其启动的小窗组件。

设计与范围见 [MVP 说明](docs/MVP.md)，Skill 位于 `skills/screen-question/SKILL.md`。
