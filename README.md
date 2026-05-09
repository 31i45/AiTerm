# AiTerm — AI 增强型 Web 终端

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen?logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

AiTerm 是一款基于 Web 的 AI 增强型终端应用，将完整的本地伪终端（PTY）与 Ollama 大语言模型深度集成，为开发者提供智能化的命令行体验。

## ✨ 核心特性

### 🖥️ 完整的本地终端

- 基于 **node-pty** 的真实伪终端，支持多标签页管理
- 跨平台 Shell 自动检测：PowerShell / CMD / Bash / Zsh
- 终端搜索（支持大小写敏感、正则表达式）
- 自适应字体缩放、右键菜单、选中文本复制粘贴
- SSH 等交互式命令完整支持

### 🤖 AI 智能助手

- 集成 **Ollama** 本地大语言模型，完全离线运行
- 流式响应（Streaming），实时输出 AI 回复
- 自动感知当前系统环境（OS、Shell、Node.js 版本、工作目录）
- 自动注入最近执行的命令及输出作为上下文
- 多语言自适应（中文/英文等，跟随用户输入语言）
- Markdown 渲染 + 27 种编程语言语法高亮

### 🔒 安全机制

- 高危命令拦截（`rm -rf /`、`dd`、`mkfs`、fork 炸弹等 6 类 32 条规则）
- WebSocket 消息类型白名单验证（仅允许 6 种消息类型）
- PTY 启动时自动过滤敏感环境变量（AWS 密钥、数据库密码等 10 类）
- Shell 路径注入防护（禁止路径遍历和特殊字符）
- HTTP 速率限制、CSP 安全策略、CORS 限制
- bcrypt 密码哈希（可选启用）
- 完整审计日志记录

### 🎨 界面与体验

- Dracula 深色主题，紫色渐变强调色
- 可拖拽调整终端/AI 面板比例
- PWA 支持，可安装为独立桌面应用
- 完全离线可用，所有前端依赖来自本地 `node_modules`

## 📋 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | >= 18.0.0 | 运行时环境 |
| npm | >= 9.0.0 | 包管理器 |
| Ollama | 最新版 | AI 功能（可选） |

> **操作系统支持**：Windows / macOS / Linux

## 🚀 快速开始

### 安装与启动

```bash
# 1. 克隆仓库
git clone https://github.com/yourusername/aiterm.git
cd aiterm

# 2. 安装依赖
npm install

# 3. 启动应用
npm start
```

启动后访问 **http://localhost:3000** 即可使用。

如果端口 3000 被占用，应用会自动尝试下一个可用端口。

### 配置 Ollama（AI 功能）

1. 安装 Ollama：https://ollama.com
2. 拉取模型：

```bash
ollama pull llama3.2
```

3. 确认 Ollama 运行中：

```bash
ollama serve
```

AiTerm 默认连接 `http://127.0.0.1:11434`，无需额外配置。

## ⚙️ 配置说明

编辑项目根目录下的 `config.json`：

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 3000
  },
  "ollama": {
    "baseUrl": "http://127.0.0.1:11434",
    "defaultModel": "llama3.2"
  },
  "security": {
    "enabled": false,
    "password": "",
    "sessionTimeout": 3600000
  },
  "highRiskCommands": [
    "rm", "rmdir", "mkfs", "dd", "reboot", "shutdown", "halt", "poweroff",
    "fdisk", "chmod 777", "chown -R", ":(){:|:&};:", "wipefs", "parted"
  ],
  "safeCommands": [
    "ls", "cd", "pwd", "cat", "echo", "date", "whoami", "ps", "top",
    "df", "du", "free", "uptime", "hostname", "uname", "clear", "man"
  ],
  "useWhitelist": false,
  "maxContextLength": 100,
  "ws": {
    "maxReconnectAttempts": 5,
    "reconnectDelayMs": 1000
  }
}
```

### 配置项说明

| 配置路径 | 类型 | 默认值 | 说明 |
|---------|------|--------|------|
| `server.host` | string | `127.0.0.1` | 监听地址 |
| `server.port` | number | `3000` | 监听端口（占用时自动递增） |
| `ollama.baseUrl` | string | `http://127.0.0.1:11434` | Ollama API 地址 |
| `ollama.defaultModel` | string | `llama3.2` | 默认 AI 模型 |
| `security.enabled` | boolean | `false` | 是否启用密码认证 |
| `security.password` | string | `""` | 认证密码（bcrypt 哈希） |
| `security.sessionTimeout` | number | `3600000` | 会话超时（毫秒） |
| `useWhitelist` | boolean | `false` | 启用命令白名单模式 |
| `maxContextLength` | number | `100` | AI 对话最大上下文长度 |
| `ws.maxReconnectAttempts` | number | `5` | WebSocket 最大重连次数 |
| `ws.reconnectDelayMs` | number | `1000` | 重连基础延迟（毫秒） |

### 环境变量覆盖

配置项也可通过环境变量覆盖：

```bash
PORT=8080 HOST=0.0.0.0 npm start
```

## ⌨️ 快捷键

### 全局快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+T` | 新建终端标签 |
| `Ctrl+Tab` | 切换到下一个标签 |
| `Ctrl+Shift+Tab` | 切换到上一个标签 |
| `Ctrl+1` ~ `Ctrl+9` | 切换到第 N 个标签 |
| `Escape` | 关闭搜索面板 / 关闭弹窗 |

### 终端操作

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+C` | 复制选中文本 / 发送 SIGINT |
| `Ctrl+V` | 粘贴 |
| `Ctrl++` | 放大字体 |
| `Ctrl+-` | 缩小字体 |
| 右键 | 打开上下文菜单 |

### 搜索

| 快捷键 | 功能 |
|--------|------|
| `Enter` | 跳到下一个匹配 |
| `Shift+Enter` | 跳到上一个匹配 |

### AI 对话

| 快捷键 | 功能 |
|--------|------|
| `Enter` | 发送消息 |
| `Shift+Enter` | 换行 |

## 🏗️ 项目结构

```
aiterm/
├── index.js                # Express 服务器 + WebSocket 网关
├── terminal-manager.js     # PTY 终端会话管理
├── logger.js               # Winston 日志系统（应用日志 + 审计日志）
├── config.json             # 应用配置
├── package.json            # 依赖声明
│
├── services/               # 后端服务层
│   ├── index.js            # 服务容器（依赖注入）
│   ├── config.js           # 配置管理（文件 + 环境变量）
│   ├── security.js         # 安全服务（认证、命令过滤、速率限制）
│   ├── ollama.js           # Ollama AI 对话（流式响应、上下文管理）
│   └── log-reader.js       # 日志文件读取（支持大文件截断）
│
├── frontend/               # 前端代码（原生 ES Modules）
│   ├── app.js              # 主应用逻辑（标签管理、WebSocket、搜索）
│   ├── styles.css          # 全局样式（Dracula 主题）
│   ├── terminal/
│   │   └── terminal.js     # xterm.js 终端封装（创建、搜索、字体）
│   └── ai/
│       ├── ai-panel.js     # AI 面板（消息渲染、Markdown、流式输出）
│       └── ai-panel.css    # AI 面板样式
│
├── public/                 # 静态资源
│   ├── index.html          # 主页面
│   ├── manifest.json       # PWA 清单
│   └── highlight-loader.js # highlight.js 语言加载器
│
├── logs/                   # 应用日志（按日轮转）
└── audit_logs/             # 审计日志（按日轮转）
```

## 🛠️ 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **运行时** | Node.js >= 18 | 服务端运行环境 |
| **Web 框架** | Express 4.x | HTTP 路由、静态文件、中间件 |
| **实时通信** | WebSocket (ws 8.x) | 终端数据流、AI 流式响应 |
| **伪终端** | node-pty 1.x | 本地 Shell 进程管理 |
| **终端渲染** | xterm.js 6.x | 浏览器端终端模拟器 |
| **AI 推理** | Ollama API | 本地大语言模型推理 |
| **Markdown** | marked 18.x | AI 回复 Markdown 解析 |
| **代码高亮** | highlight.js 11.x | 27 种编程语言语法高亮 |
| **XSS 防护** | DOMPurify 3.x | HTML 输出净化 |
| **日志** | Winston 3.x | 结构化日志（按日轮转） |
| **认证** | bcrypt 6.x | 密码哈希（可选） |

## 🔐 安全架构

### 命令过滤

AiTerm 内置 6 类高危命令检测规则，基于正则表达式实时匹配：

| 类别 | 示例 |
|------|------|
| 破坏性删除 | `rm -rf /`、`rm -rf /*` |
| 磁盘格式化 | `mkfs`、`wipefs`、`dd of=/dev/sd*` |
| 系统控制 | `reboot`、`shutdown`、`halt`、`poweroff` |
| Fork 炸弹 | `:(){ :\|:& };:` |
| 危险权限 | `chmod 777 /` |
| 关键文件覆盖 | `mv /`、`cp /dev/null` |

支持切换为**白名单模式**（`useWhitelist: true`），仅允许执行预定义的安全命令。

### 环境隔离

PTY 进程启动时自动过滤以下敏感环境变量：

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`
- `DATABASE_URL` / `DB_PASSWORD`
- `SECRET_KEY` / `PRIVATE_KEY`
- `API_KEY` / `AUTH_TOKEN` / `PASSWORD` / `TOKEN`

### 通信安全

- WebSocket 消息类型白名单（仅允许 6 种消息类型）
- Shell 路径注入防护（禁止路径遍历和特殊字符）
- HTTP 速率限制（防止 API 滥用）
- Content Security Policy（CSP）
- CORS 限制（默认仅允许本地访问）

## 📊 日志系统

| 日志类型 | 目录 | 轮转策略 | 说明 |
|---------|------|---------|------|
| 应用日志 | `logs/` | 按日轮转，保留 30 天 | 服务运行日志 |
| 审计日志 | `audit_logs/` | 按日轮转，保留 30 天 | 操作审计记录 |

审计日志记录以下事件类型：

- `SESSION_CREATE` — 会话创建
- `SESSION_CLOSE` — 会话关闭
- `AUTH_SUCCESS` — 认证成功
- `AUTH_FAILURE` — 认证失败
- `COMMAND_EXEC` — 命令执行
- `COMMAND_BLOCKED` — 命令被拦截
- `RATE_LIMIT` — 速率限制触发

## 📄 许可证

[MIT License](LICENSE)
