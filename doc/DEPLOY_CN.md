# 部署指南

[English](./DEPLOY.md) | [中文](./DEPLOY_CN.md)

OpenVia 使用 [Bun](https://bun.sh) (推荐 v1.2+)
编译为单文件独立可执行二进制程序。

---

## 环境要求

- **Bun**: v1.2.0 或更高版本
- **Node.js**: v18.0.0 或更高版本

## 1. 源码编译

在开发环境（Windows/Mac/Linux 均可）执行以下命令：

```bash
# 编译当前平台版本
bun run build

# 编译 Linux x64
bun run build:linux

# 编译 Windows x64
bun run build:win

# 编译 macOS x64
bun run build:mac

# 编译 macOS ARM64 (Apple Silicon)
bun run build:mac-arm

# 编译所有平台版本
bun run build:all
```

构建完成后，你可以在 `dist/` 目录下找到生成的可执行文件。

---

## 2. 服务器环境准备

虽然 `openvia` 编译后是独立运行的二进制文件，但由于其内部依赖
`@anthropic-ai/claude-agent-sdk` 调用的 `claude`
CLI。因此，目标服务器**必须**具备：

1. **Node.js 环境** (用于运行 claude-code)
2. **Claude Code CLI**

### 安装步骤

在你的 Linux 服务器上执行：

```bash
# 1. 安装 Node.js
# (建议使用 nvm 或系统包管理器)

# 2. 全局安装 claude-code
npm install -g @anthropic-ai/claude-code

# 3. 验证安装
claude --version
```

---

## 3. 运行 OpenVia

### 3.1 环境准备

1. 创建运行目录，例如 `/opt/openvia`
2. 将 `openvia-linux` 二进制文件上传至此目录
3. 赋予执行权限：

```bash
chmod +x openvia-linux
```

### 3.2 初始化配置

```bash
# 初始化配置目录 (~/.openvia/)
./openvia-linux init

# 通过环境变量设置 Telegram Bot Token
export TELEGRAM_BOT_TOKEN="your-bot-token"
# 或者通过配置文件设置
./openvia-linux config set telegram.botToken "your-bot-token"

# 查看当前配置
./openvia-linux config
```

### 3.3 运行方式

**方式 A：直接运行**

```bash
./openvia-linux
```

**方式 B：使用环境文件**

创建 `/opt/openvia/.env`:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
ALLOWED_USER_IDS=123456789,987654321
CLAUDE_TIMEOUT=120000
LOG_LEVEL=info
```

然后运行：

```bash
cd /opt/openvia
source .env && ./openvia-linux
```

**方式 C：使用 Systemd 守护进程 (推荐)**

创建 `/etc/systemd/system/openvia.service`:

```ini
[Unit]
Description=OpenVia AI Agent Gateway
After=network.target

[Service]
Type=simple
User=root
# 运行目录：建议设置为源码根目录
WorkingDirectory=%h/workspaces/OpenVia
# 注入环境变量：PATH 必须包含 node, bun 以及 claude 的路径
Environment="PATH=%h/.local/bin:%h/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# 执行程序路径
ExecStart=%h/workspaces/OpenVia/dist/openvia
Restart=always

[Install]
WantedBy=multi-user.target
```

> [!TIP]
>
> 1. `%h` 是 systemd 的占位符，会自动展开为当前用户的家目录（如
>    `/home/your-user`）。
> 2. `WorkingDirectory` 应该设置为你存放 OpenVia 源码或二进制文件的目录。
> 3. 如果通过 Bun 编译为单文件后无法定位 `claude`，可以通过配置
>    `CLAUDE_EXECUTABLE_PATH` 环境变量手动指定路径。

管理服务：

```bash
systemctl daemon-reload
systemctl enable openvia
systemctl start openvia
```

---

## 4. 配置详情

### 目录结构

```
~/.openvia/
├── config.json     # 用户配置文件
├── sessions/       # Claude 会话缓存
└── logs/           # (预留)
```

### 配置优先级

`命令行参数 > 环境变量 > ~/.openvia/config.json > 默认值`
