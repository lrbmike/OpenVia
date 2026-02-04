# 部署指南

[English](./DEPLOY.md) | [中文](./DEPLOY_CN.md)

OpenVia 使用 [Bun](https://bun.sh) (推荐 v1.2+)
编译为单文件独立可执行二进制程序。

---

## 环境要求

- **Bun**: v1.2.0 或更高版本
- **Node.js**: v18.0.0 或更高版本

### 1. 源码编译

在开发环境（Windows/Mac/Linux 均可）执行以下命令：

```bash
# 方式 A: 编译为 Node.js 脚本 (推荐用于发布到 npm 或本地开发)
# 生成: dist/index.js
bun run build

# 方式 B: 编译为单文件独立二进制程序 (推荐用于服务器部署)
# 生成: dist/openvia-linux (Linux), dist/openvia.exe (Windows) 等
bun run build:linux
bun run build:win
bun run build:mac
bun run build:mac-arm

# 编译所有平台版本
bun run build:all
```

构建完成后：

- 如果运行 `bun run build`，你需要使用 `node dist/index.js` 启动。
- 如果运行 `bun run build:linux`，你直接运行 `./dist/openvia-linux`。

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
# 建议使用普通用户运行，以确保能读取到 ~/.openvia/ 目录下的配置
User=<your-user>
# 运行目录：设置为源码根目录或二进制文件所在目录
WorkingDirectory=/home/<your-user>/workspaces/OpenVia
# 注入环境变量：PATH 必须包含 node, bun 以及 claude 的路径
# 注意：systemd 不会自动加载 .bashrc，必须在这里明确指定 PATH
Environment="PATH=/home/<your-user>/.local/bin:/home/<your-user>/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# 执行程序路径 (选择其中一种方式):
# 方式 1: 如果使用独立二进制程序 (推荐)
ExecStart=/home/<your-user>/workspaces/OpenVia/dist/openvia-linux

# 方式 2: 如果运行 Node.js 脚本 (dist/index.js)
# ExecStart=/usr/bin/node /home/<your-user>/workspaces/OpenVia/dist/index.js

Restart=always

[Install]
WantedBy=multi-user.target
```

> [!IMPORTANT]
>
> 1. **User 设置**: 如果你使用 `User=root`运行，OpenVia 会尝试从
>    `/root/.openvia/` 读取配置。如果你在开发时使用的是普通用户（如
>    `<your-user>`），请将 `User` 修改为对应的用户名。
> 2. **重新编译**: 如果你最近修改了代码（如增加了飞书支持），请务必执行
>    `bun run build` 重新生成 `dist/openvia`。
> 3. **绝对路径**: 在 `Service` 配置中，建议使用绝对路径（如
>    `/home/<your-user>/...`）代替 `%h`，以避免某些 systemd 版本中的解析问题。

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
└── logs/           # 日志目录
    └── app-2026-02-04.log  # 按日切分的运行时日志
```

### 查看日志

1. **Systemd 日志 (推荐)**:
   ```bash
   # 实时查看服务日志
   sudo journalctl -u openvia -f
   ```

2. **本地日志文件**:
   ```bash
   # 查看应用写入的日志文件
   tail -f ~/.openvia/logs/app.log
   ```

### 配置优先级

`命令行参数 > 环境变量 > ~/.openvia/config.json > 默认值`
