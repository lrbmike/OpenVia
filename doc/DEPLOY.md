# Deployment Guide

[English](./DEPLOY.md) | [中文](./DEPLOY_CN.md)

OpenVia is compiled as a standalone binary using [Bun](https://bun.sh) (v1.2+
recommended).

---

## Prerequisites

- **Bun**: v1.2.0 or higher
- **Node.js**: v18.0.0 or higher

## 1. Build from Source

Execute the following commands in your development environment
(Windows/Mac/Linux):

```bash
# Build for current platform
bun run build

# Build Linux x64
bun run build:linux

# Build Windows x64
bun run build:win

# Build macOS x64
bun run build:mac

# Build macOS ARM64 (Apple Silicon)
bun run build:mac-arm

# Build all platforms
bun run build:all
```

The compiled binaries will be located in the `dist/` directory.

---

## 2. Server Requirements

Although `openvia` is a standalone binary, it depends on
`@anthropic-ai/claude-agent-sdk`, which calls the `claude` CLI. Therefore, the
server **must** have:

1. **Node.js Environment** (to run claude-code)
2. **Claude Code CLI**

### Installation Steps

On your Linux server:

```bash
# 1. Install Node.js
# (Recommended using nvm or package manager)

# 2. Install claude-code globally
npm install -g @anthropic-ai/claude-code

# 3. Verify installation
claude --version
```

---

## 3. Running OpenVia

### 3.1 Setup

1. Create a directory, e.g., `/opt/openvia`
2. Upload the `openvia-linux` binary to this directory
3. Grant execution permission:

```bash
chmod +x openvia-linux
```

### 3.2 Initialize Configuration

```bash
# Initialize config directory (~/.openvia/)
./openvia-linux init

# Set Telegram Bot Token via environment
export TELEGRAM_BOT_TOKEN="your-bot-token"
# OR via config file
./openvia-linux config set telegram.botToken "your-bot-token"

# View configuration
./openvia-linux config
```

### 3.3 Running Options

**Option A: Direct Execution**

```bash
./openvia-linux
```

**Option B: Using Environment File**

Create `/opt/openvia/.env`:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
ALLOWED_USER_IDS=123456789,987654321
CLAUDE_TIMEOUT=120000
LOG_LEVEL=info
```

Then run:

```bash
cd /opt/openvia
source .env && ./openvia-linux
```

**Option C: Using Systemd (Recommended)**

Create `/etc/systemd/system/openvia.service`:

```ini
[Unit]
Description=OpenVia AI Agent Gateway
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/openvia
ExecStart=/opt/openvia/openvia-linux
Restart=always
Environment="TELEGRAM_BOT_TOKEN=your-token-here"
Environment="ALLOWED_USER_IDS=123456789"
# Path to node/npm if not in standard PATH
# Environment="PATH=/usr/bin:/usr/local/bin:/root/.nvm/versions/node/v20.x/bin"

[Install]
WantedBy=multi-user.target
```

Manage the service:

```bash
systemctl daemon-reload
systemctl enable openvia
systemctl start openvia
```

---

## 4. Configuration Details

### Directory Structure

```
~/.openvia/
├── config.json     # User configuration
├── sessions/       # Claude session cache
└── logs/           # (Reserved)
```

### Priority

`CLI Arguments > Environment Variables > ~/.openvia/config.json > Default Values`
