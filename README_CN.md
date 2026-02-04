# OpenVia 中文指南

[English](./README.md) | [中文](./README_CN.md)

通用且可扩展的 AI Agent 命令行网关。

## 项目简介

OpenVia 是连接现代 AI Agent（如 Claude Code）与通信平台（如
Telegram）的桥梁。它让你能够通过移动端或 Web 界面安全地与本地运行的 AI Agent
进行交互。

## 核心功能

- 🤖 **Agent 交互**: 通过 Telegram 无缝对接 Claude AI 或其他 Agent。
- 🔧 **原生技能支持**: 支持文件系统访问、搜索、Git 操作和 Shell 执行。
- 🔒 **安全可控**: 用户白名单、Shell 命令白名单，以及通过 Telegram
  实时确认的高级权限请求。
- 📝 **会话管理**: 自动管理对话历史，支持会话持久化。
- 🚀 **跨平台**: 提供无依赖的 Linux、Windows 和 macOS 二进制文件。
- ⚡ **Bun 驱动**: 基于高性能 Bun 运行时（推荐 v1.2+）。

---

## 环境准备

- **Bun**: 运行或从源码编译需要 v1.2.0 或更高版本。
- **Node.js**: v18+ (运行 Claude Code CLI 所需)。

## 安装说明

### 方式 1：通过 npm 安装 (推荐)

```bash
npm install -g @lrbmike/openvia
# 或者使用 bun
bun install -g @lrbmike/openvia
```

### 方式 2：下载预编译二进制文件

从 [Releases](https://github.com/lrbmike/OpenVia/releases)
下载对应平台的执行文件：

- `openvia-linux` - Linux x64
- `openvia.exe` - Windows x64
- `openvia-darwin` - macOS x64
- `openvia-darwin-arm64` - macOS Apple Silicon (M1/M2/M3)

```bash
# Linux/macOS
chmod +x openvia-linux
./openvia-linux --help
```

### 方式 3：从源码安装 (开发者)

```bash
# 克隆仓库
git clone https://github.com/lrbmike/OpenVia.git
cd OpenVia

# 安装依赖
bun install

# 全局链接
bun link
```

---

## 快速开始

### 1. 初始化配置

```bash
openvia init
```

这将在 `~/.openvia/` 目录下创建必要的配置文件。

### 2. 配置 Token

````bash
# 方式一：环境变量
export TELEGRAM_BOT_TOKEN="your-bot-token"

# 方式二：配置文件
openvia config set telegram.botToken "your-bot-token"

### 配置文件示例 (`~/.openvia/config.json`)

```json
{
  "adapters": {
    "default": "telegram",
    "telegram": {
      "botToken": "your-telegram-bot-token",
      "allowedUserIds": [123456789]
    },
    "feishu": {
      "appId": "cli_a4d...",
      "appSecret": "your-app-secret",
      "wsEndpoint": "wss://..."
    }
  },
  "claude": {
    "model": "claude-3-5-sonnet-20240620",
    "timeout": 120000,
    "systemPrompt": "Always answer in Chinese (请用中文回答)",
    // 需确认的敏感命令列表。
    // 注意：配置此项会【覆盖/Overwrite】默认列表，而不是追加。
    // 默认值包含: rm, mv, sudo, su, dd, reboot, shutdown, mkfs, chmod, chown, wget, curl, >, >>, &, |
    "shellConfirmList": ["rm", "mv", "sudo", ">"]

  }
}
````

````
### 3. 安装 Claude CLI

```bash
npm install -g @anthropic-ai/claude-code
claude  # 完成登录认证
````

### 4. 运行网关

```bash
openvia
```

---

## 命令行用法

```
openvia [command] [options]

Commands:
  openvia            启动网关 (默认)
  openvia start      启动网关
  openvia init       初始化配置目录和文件
  openvia config     查看当前配置
  openvia config set 设置配置项
  openvia config get 获取配置项
  openvia help       显示帮助信息
  openvia version    显示版本号

Options:
  -t, --timeout <ms>     设置超时时间 (毫秒)
  -m, --model <name>     指定 Claude 模型
  -v, --verbose          开启详细日志
  -c, --config <path>    指定自定义配置文件路径
  -h, --help             显示帮助
  --version              显示版本
```

---

## 技能列表

| 技能           | 描述                         |
| -------------- | ---------------------------- |
| `exec_shell`   | 执行 Shell 命令 (仅限白名单) |
| `read_file`    | 读取文件内容                 |
| `search_files` | 搜索文件                     |
| `http_request` | 发起 HTTP 请求               |
| `git_status`   | 获取 Git 仓库状态            |

---

## 说明文档

- [部署指南](./doc/DEPLOY_CN.md)

## 开源协议

MIT

## 未来规划

1. **多平台并发支持**：目前 OpenVia 启动时仅支持激活一个默认 Channel（Telegram
   或 Feishu）。未来架构将支持同时监听多个平台的请求，实现跨平台互通。
2. **插件系统**：支持用户动态加载自定义 Skill，无需修改核心代码。
3. **Web 管理界面**：提供可视化的配置管理和 Session 查看器。
