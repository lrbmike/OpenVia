# OpenVia

[English](./README.md) | [中文](./README_CN.md)

Universal, Extensible CLI Gateway for AI Agents.

## Overview

OpenVia is a bridge between modern AI Agents (like Claude Code) and
communication platforms (like Telegram). It allows you to interact with your
local AI Agent through a mobile or web interface securely.

## Features

- 🤖 **Agent Interaction**: Seamlessly talk to Claude AI or other Agents via
  Telegram.
- 🔧 **Native Skills**: Supports file system access, search, git operations, and
  shell execution.
- 🔒 **Secure by Design**: User whitelist, shell command whitelisting, and
  granular permission requests via Telegram.
- 📝 **History Management**: Automatic conversation history and session
  persistence.
- 🚀 **Cross-Platform**: Zero-dependency binary available for Linux, Windows,
  and macOS.
- ⚡ **Powered by Bun**: Built on high-performance Bun runtime (v1.2+
  recommended).

---

## Prerequisites

- **Bun**: v1.2.0 or higher is required to run or build from source.
- **Node.js**: v18+ (Required for Claude Code CLI).

## Installation

### Option A: Install via npm (Recommended for users)

```bash
npm install -g @lrbmike/openvia
# or
bun install -g @lrbmike/openvia
```

### Option B: Download Pre-built Binary

Download the executable for your platform from
[Releases](https://github.com/lrbmike/OpenVia/releases):

- `openvia-linux` - Linux x64
- `openvia.exe` - Windows x64
- `openvia-darwin` - macOS x64
- `openvia-darwin-arm64` - macOS Apple Silicon

```bash
# Linux/macOS
chmod +x openvia-linux
./openvia-linux --help
```

### Option C: Install from Source (For developers)

```bash
# Clone the repository
git clone https://github.com/lrbmike/OpenVia.git
cd OpenVia

# Install dependencies
bun install

# Link globally
bun link
```

---

## Quick Start

### 1. Initialize Configuration

```bash
openvia init
```

This creates a configuration directory at `~/.openvia/`.

### 2. Configure Token

````bash
# Option A: Environment Variable
export TELEGRAM_BOT_TOKEN="your-bot-token"

# Option B: Config File
openvia config set telegram.botToken "your-bot-token"

### Configuration Example (`~/.openvia/config.json`)

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
    "systemPrompt": "Always answer in Chinese"
  }
}
````

````
### 3. Ensure Claude CLI is Installed

```bash
npm install -g @anthropic-ai/claude-code
claude  # Complete authentication
````

### 4. Run the Gateway

```bash
openvia
```

---

## CLI Usage

```
openvia [command] [options]

Commands:
  openvia            Start the gateway (default)
  openvia start      Start the gateway
  openvia init       Initialize config directory and file
  openvia config     View current configuration
  openvia config set Set configuration item
  openvia config get Get configuration item
  openvia help       Display help information
  openvia version    Display version number

Options:
  -t, --timeout <ms>     Set request timeout (ms)
  -m, --model <name>     Set Claude model
  -v, --verbose          Enable verbose logging
  -c, --config <path>    Specify custom config file
  -h, --help             Display help
  --version              Display version
```

---

## Configuration

### Config File

Location: `~/.openvia/config.json`

```json
{
  "telegram": {
    "botToken": "",
    "allowedUserIds": []
  },
  "claude": {
    "apiKey": "",
    "baseUrl": "https://api.anthropic.com",
    "model": "claude-sonnet-4-5-20250929",
    "timeout": 120000,
    "permissionMode": "default",
    "shellWhitelist": ["ls", "cat", "pwd", "git status", "echo"],
    "systemPrompt": "Always answer in Chinese"
  },
  "logging": {
    "level": "info",
    "verbose": false
  }
}
```

### Configuration Priority

`CLI Arguments > Environment Variables > Config File > Default Values`

---

## Skills List

| Skill          | Description                          |
| -------------- | ------------------------------------ |
| `exec_shell`   | Execute shell commands (whitelisted) |
| `read_file`    | Read file contents                   |
| `search_files` | Search for files                     |
| `http_request` | Make HTTP requests                   |
| `git_status`   | Get git repository status            |

---

## Development

```bash
# Dev mode (hot reload)
bun run dev

# Build for current platform
bun run build

# Build for all platforms
bun run build:all
```

---

## Documentation

- [Deployment Guide](./doc/DEPLOY.md)

## License

MIT

## Roadmap

1. **Concurrent Multi-platform Support**: Currently, OpenVia activates a single
   default channel (Telegram or Feishu) at startup. Future architecture will
   support simultaneous listening on multiple platforms.
2. **Plugin System**: Support dynamic loading of custom user Skills.
3. **Web Dashboard**: Visual configuration management and session viewer.
