# Deployment Guide

[English](./DEPLOY.md) | [中文](./DEPLOY_CN.md)

OpenVia is compiled as a standalone binary using [Bun](https://bun.sh) (v1.2+
recommended).

---

## Prerequisites

- **Bun**: v1.2.0 or higher
- **Node.js**: v18.0.0 or higher

### 1. Build from Source

Execute the following commands in your development environment:

```bash
# Option A: Build as a Node.js script (for npm or local dev)
# Output: dist/index.js
bun run build

# Option B: Build as a standalone binary (for server deployment)
# Output: dist/openvia-linux (Linux), dist/openvia.exe (Windows), etc.
bun run build:linux
bun run build:win
bun run build:mac
bun run build:mac-arm

# Build all platforms
bun run build:all
```

After build:

- If you ran `bun run build`, use `node dist/index.js` to start.
- If you ran `bun run build:linux`, use `./dist/openvia-linux` directly.

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
# Recommended to run as a non-root user to ensure ~/.openvia/ configuration is accessible
User=<your-user>
# Working Directory: Set to the project root or the directory where the binary is located
WorkingDirectory=/home/<your-user>/workspaces/OpenVia
# Environment: PATH must contain paths to node, bun, and claude
# Note: systemd does not automatically load .bashrc, so PATH must be explicitly defined here
Environment="PATH=/home/<your-user>/.local/bin:/home/<your-user>/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Execution Path (Choose one):
# Option 1: Using standalone binary (Recommended)
ExecStart=/home/<your-user>/workspaces/OpenVia/dist/openvia-linux

# Option 2: Running Node.js script (dist/index.js)
# ExecStart=/usr/bin/node /home/lrbmike/workspaces/OpenVia/dist/index.js

Restart=always

[Install]
WantedBy=multi-user.target
```

> [!IMPORTANT]
>
> 1. **User Setting**: If you run as `User=root`, OpenVia will look for
>    configuration in `/root/.openvia/`. If you developed as a regular user
>    (e.g., `<your-user>`), update `User` accordingly.
> 2. **Rebuild**: If you have recently modified the source code (e.g., added
>    Feishu support), ensure you run `bun run build` to regenerate the
>    `dist/openvia` binary.
> 3. **Absolute Paths**: It is recommended to use absolute paths (e.g.,
>    `/home/<your-user>/...`) instead of `%h` in the `Service` configuration to
>    avoid parsing issues in some systemd versions.

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
└── logs/           # Log directory
    └── app-2026-02-04.log  # Daily-rotated runtime logs
```

### Viewing Logs

1. **Systemd Logs (Recommended)**:
   ```bash
   # View real-time service logs
   sudo journalctl -u openvia -f
   ```

2. **Local Log File**:
   ```bash
   # View logs written by the application
   tail -f ~/.openvia/logs/app.log
   ```

### Priority

`CLI Arguments > Environment Variables > ~/.openvia/config.json > Default Values`
