# OpenVia 中文指南

[English](./README.md) | [中文](./README_CN.md)

通用且可扩展的 AI Agent 命令行网关。

## 项目简介

OpenVia 是连接 AI
大语言模型与通信平台（Telegram、飞书等）的桥梁。它提供统一的网关，让你能够通过移动端或
Web 界面安全地与 AI 进行交互。

## 核心功能

- **多 LLM 支持**: 支持 OpenAI、Claude、Qwen、DeepSeek、Moonshot 及任何 OpenAI
  兼容 API。
- **多渠道接入**: 支持 Telegram、飞书，可扩展的渠道架构。
- **内置工具**: 文件操作、Shell 执行，可扩展的工具注册表。
- **Skills 系统**: 用户自定义知识扩展，存放于 `~/.openvia/skills/`。
- **安全可控**: 用户白名单、Shell 命令确认、细粒度权限请求。
- **会话管理**: 自动管理对话历史，支持会话持久化。
- **Bun 驱动**: 基于高性能 Bun 运行时（推荐 v1.2+）。

---

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenVia Gateway                          │
├─────────────┬─────────────┬─────────────┬──────────────────┤
│  Telegram   │    飞书     │   (未来)    │   Bot Channels   │
├─────────────┴─────────────┴─────────────┴──────────────────┤
│                    Router / Orchestrator                     │
├─────────────────────────────────────────────────────────────┤
│                      Agent Gateway                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ LLM Adapter │  │   Policy    │  │   Tool      │         │
│  │  (OpenAI)   │  │   Engine    │  │  Executor   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
├─────────────────────────────────────────────────────────────┤
│  Tools: bash, read_file, write_file, edit_file, ...         │
│  Skills: ~/.openvia/skills/ (用户自定义知识)                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 环境准备

- **Bun**: v1.2.0 或更高版本（从源码运行）
- **Node.js**: v18+（可选，用于 npm 安装）

## 安装说明

### 方式 1：通过 npm 安装

```bash
npm install -g @lrbmike/openvia
# 或者
bun install -g @lrbmike/openvia
```

### 方式 2：下载预编译二进制文件

从 [Releases](https://github.com/lrbmike/OpenVia/releases) 下载：

- `openvia-linux` - Linux x64
- `openvia.exe` - Windows x64
- `openvia-darwin` - macOS x64
- `openvia-darwin-arm64` - macOS Apple Silicon

### 方式 3：从源码安装

```bash
git clone https://github.com/lrbmike/OpenVia.git
cd OpenVia
bun install
bun link
```

---

## 快速开始

### 1. 初始化配置

```bash
openvia init
```

这将创建 `~/.openvia/config.json`。

### 2. 配置 LLM 和渠道

编辑 `~/.openvia/config.json`：

```json
{
  "adapters": {
    "default": "telegram",
    "telegram": {
      "botToken": "your-telegram-bot-token",
      "allowedUserIds": [123456789]
    },
    "feishu": {
      "appId": "your-app-id",
      "appSecret": "your-app-secret"
    }
  },
  "llm": {
    "format": "openai",
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o",
    "systemPrompt": "你是一个有用的助手。运行在 Windows 系统上，请使用 PowerShell 命令。",
    "timeout": 120000,
    "maxTokens": 4096,
    "maxIterations": 10,
    "shellConfirmList": ["rm", "mv", "sudo", "del", "rmdir"]
  },
  "logging": {
    "level": "info"
  }
}
```

### 3. 运行网关

```bash
openvia
```

---

## 配置说明

### LLM 配置

| 字段               | 说明                                     |
| ------------------ | ---------------------------------------- |
| `format`           | API 格式: `openai`、`claude` 或 `gemini` |
| `apiKey`           | 你的 API 密钥                            |
| `baseUrl`          | API 端点（支持自定义代理）               |
| `model`            | 模型名称（如 `gpt-4o`、`qwen-max`）      |
| `systemPrompt`     | 所有对话的系统提示词                     |
| `maxIterations`    | 每条消息最大工具调用轮次（默认: 10）     |
| `shellConfirmList` | 需要用户确认的命令列表                   |

### 支持的 LLM 提供商

| 提供商          | 格式     | baseUrl 示例                                        |
| --------------- | -------- | --------------------------------------------------- |
| OpenAI          | `openai` | `https://api.openai.com/v1`                         |
| Claude          | `openai` | `https://api.anthropic.com/v1`                      |
| Qwen (通义千问) | `openai` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| DeepSeek        | `openai` | `https://api.deepseek.com/v1`                       |
| Moonshot        | `openai` | `https://api.moonshot.cn/v1`                        |

---

## Skills 系统

Skills 是用户自定义的知识扩展，存放于 `~/.openvia/skills/`。

### Skill 结构

```
~/.openvia/skills/
└── my-skill/
    ├── SKILL.md      # 必需：Markdown 格式的指令
    └── scripts/      # 可选：辅助脚本
```

### 示例 Skill

`~/.openvia/skills/current-time/SKILL.md`：

````markdown
---
name: 时间专家
description: 获取各种格式的当前时间
---

# 获取当前时间

使用 PowerShell 获取当前时间：

```powershell
powershell -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"
```
````

````
AI 会在相关时自动使用 `read_skill` 加载这些知识。

---

## 内置工具

| 工具 | 说明 |
|------|------|
| `bash` | 执行 Shell 命令 |
| `read_file` | 读取文件内容 |
| `write_file` | 写入文件内容 |
| `edit_file` | 编辑文件（替换内容） |
| `list_skills` | 列出可用的用户 Skills |
| `read_skill` | 读取 Skill 指令 |

---

## 开发

```bash
# 开发模式（热重载）
bun run dev

# 构建
bun run build

# 构建所有平台
bun run build:all
````

---

## 开源协议

MIT

## 未来规划

1. **多渠道并发**: 支持同时监听多个平台。
2. **Web 管理界面**: 可视化配置和会话管理。
3. **更多 LLM 格式**: 原生 Claude 和 Gemini 格式支持。
