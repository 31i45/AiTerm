# AiTerm — AI-Enhanced Web Terminal

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen?logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

AiTerm is a Web-based AI-enhanced terminal application that deeply integrates a full local pseudo-terminal (PTY) with Ollama large language models to provide developers with an intelligent command-line experience.

<img width="1750" height="1075" alt="image" src="https://github.com/user-attachments/assets/30723ea4-d1b7-4916-a35b-0516e1eb4864" />

## Architecture Diagram

<img width="711" height="922" alt="image" src="https://github.com/user-attachments/assets/d74a38fd-a386-4765-85a0-296408a24ba4" />

## ✨ Core Features

### 🖥️ Full Local Terminal

- Real pseudo-terminal based on **node-pty**, supporting multi-tab management.
- Automatic cross-platform Shell detection: PowerShell / CMD / Bash / Zsh.
- Terminal search (supports case-sensitivity and regular expressions).
- Adaptive font scaling (8-32px), right-click menu, and copy-paste for selected text.
- Full support for interactive commands such as SSH.

### 🤖 AI Intelligent Assistant

- Integrated **Ollama** local LLMs for fully offline operation.
- Streaming responses for real-time AI output.
- Automatic awareness of current system environment (OS, Shell, Node.js version, working directory).
- Automatic injection of recently executed commands and output as context.
- Multi-language adaptation (follows user input language).
- Markdown rendering + syntax highlighting for 27 programming languages.

### 🔒 Security Mechanisms

- High-risk command interception (real-time matching based on 6 regex patterns).
- WebSocket message type whitelist validation (7 message types).
- Automatic filtering of sensitive environment variables upon PTY startup (10 categories including AWS keys, database passwords, etc.).
- Shell path injection protection (prohibits path traversal and special characters).
- HTTP rate limiting (120 req/min), CSP security policies, and CORS restrictions.
- bcrypt password hashing (optional).
- Comprehensive audit logging.

### 🎨 Interface & Experience

- Dracula dark theme with purple gradient accents.
- Draggable adjustment of the Terminal/AI panel proportions.
- PWA support, allowing installation as a standalone desktop application.
- Fully offline capable; all frontend dependencies are served from local `node_modules`.

## 📋 Environment Requirements

| Dependency | Minimum Version | Description |
|------------|-----------------|-------------|
| Node.js    | >= 18.0.0      | Runtime Environment |
| npm        | >= 9.0.0       | Package Manager |
| Ollama     | Latest          | AI Features (Optional) |

> **OS Support**: Windows / macOS / Linux

## 🚀 Quick Start

### Installation and Launch

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/aiterm.git
cd aiterm

# 2. Install dependencies
npm install

# 3. Start the application
npm start
```

After starting, visit **http://localhost:3000** to use the application.

If port 3000 is occupied, the application will automatically try the next available port.

### Configuring Ollama (AI Features)

1. Install Ollama: https://ollama.com
2. Pull a model:

```bash
ollama pull llama3.2
```

3. Confirm Ollama is running:

```bash
ollama serve
```

AiTerm connects to `http://127.0.0.1:11434` by default, requiring no additional configuration.

## ⚙️ Configuration

Edit the `config.json` file in the project root:

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
  "maxContextLength": 100,
  "ws": {
    "maxReconnectAttempts": 5,
    "reconnectDelayMs": 1000
  },
  "limits": {
    "maxSessionsPerUser": 10,
    "maxCommandLength": 10000,
    "rateLimit": {
      "windowMs": 60000,
      "maxRequests": 120
    }
  },
  "ui": {
    "maxMessages": 500,
    "maxMessagesFallback": 100
  }
}
```

### Configuration Details

| Config Path | Type | Default | Description |
|-------------|------|---------|-------------|
| `server.host` | string | `127.0.0.1` | Listening address |
| `server.port` | number | `3000` | Listening port (auto-increments if occupied) |
| `ollama.baseUrl` | string | `http://127.0.0.1:11434` | Ollama API address |
| `ollama.defaultModel` | string | `llama3.2` | Default AI model |
| `security.enabled` | boolean | `false` | Whether to enable password authentication |
| `security.password` | string | `""` | Auth password (bcrypt hash) |
| `security.sessionTimeout` | number | `3600000` | Session timeout (milliseconds) |
| `maxContextLength` | number | `100` | Max context length for AI conversation |
| `ws.maxReconnectAttempts` | number | `5` | Max WebSocket reconnection attempts |
| `ws.reconnectDelayMs` | number | `1000` | Base reconnection delay (milliseconds) |
| `limits.maxSessionsPerUser` | number | `10` | Max terminal sessions per user |
| `limits.maxCommandLength` | number | `10000` | Max command length (characters) |
| `limits.rateLimit.windowMs` | number | `60000` | Rate limit window (milliseconds) |
| `limits.rateLimit.maxRequests` | number | `120` | Max requests per window |
| `ui.maxMessages` | number | `500` | Max messages in AI conversation |
| `ui.maxMessagesFallback` | number | `100` | Fallback count for storage failure |

### Environment Variable Overrides

Configuration options can also be overridden via environment variables:

```bash
PORT=8080 HOST=0.0.0.0 npm start
```

## ⌨️ Shortcuts

### Terminal Operations

| Shortcut | Function |
|----------|----------|
| `Ctrl+C` | Copy selected text / Send SIGINT |
| `Ctrl+V` | Paste |
| `Ctrl++` | Zoom in font |
| `Ctrl+-` | Zoom out font |
| `Ctrl+F` | Open search panel |
| Right Click | Open context menu |

### Search

| Shortcut | Function |
|----------|----------|
| `Enter` | Jump to next match |
| `Shift+Enter` | Jump to previous match |
| `Escape` | Close search panel |

### AI Conversation

| Shortcut | Function |
|----------|----------|
| `Enter` | Send message |
| `Shift+Enter` | New line |

## 🏗️ Project Structure

```
aiterm/
├── index.js                # Express Server + WebSocket Gateway
├── terminal-manager.js     # PTY Terminal Session Management
├── logger.js               # Winston Logging System (App Logs + Audit Logs)
├── config.json             # App Configuration
├── package.json            # Dependency Declarations
│
├── services/               # Backend Service Layer (Dependency Injection Pattern)
│   ├── index.js            # Service Container
│   ├── config.js           # Configuration Management (File + Env Vars)
│   ├── security.js         # Security Services (Auth, Command Filtering, Rate Limiting)
│   ├── ollama.js           # Ollama AI Conversation (Streaming, Context Management)
│   └── log-reader.js       # Log File Reader (Supports large file truncation)
│
├── frontend/               # Frontend Code (Native ES Modules)
│   ├── app.js              # Main App Logic (Tab Management, WebSocket, Search)
│   ├── styles.css          # Global Styles (Dracula Theme)
│   ├── terminal/
│   │   └── terminal.js     # xterm.js Wrapper (Creation, Search, Fonts)
│   └── ai/
│       ├── ai-panel.js     # AI Panel (Message Rendering, Markdown, Streaming)
│       └── ai-panel.css    # AI Panel Styles
│
├── public/                 # Static Assets
│   ├── index.html          # Main Page
│   ├── manifest.json       # PWA Manifest
│   └── highlight-loader.js # highlight.js Language Loader
│
├── logs/                   # App Logs (Daily rotation)
└── audit_logs/             # Audit Logs (Daily rotation)
```

## 🛠️ Tech Stack

| Layer | Technology | Version | Description |
|-------|------------|---------|-------------|
| **Runtime** | Node.js | >= 18.0.0 | Server-side runtime environment |
| **Web Framework** | Express | 5.x | HTTP routing, static files, middleware |
| **Real-time** | ws | 8.x | WebSocket server |
| **Pseudo-terminal** | node-pty | 1.x | Local Shell process management |
| **Terminal Rendering** | xterm.js | 6.x | Browser-side terminal emulator |
| **AI Inference** | Ollama API | - | Local LLM inference |
| **Markdown** | marked | 18.x | AI response Markdown parsing |
| **Code Highlighting** | highlight.js | 11.x | Syntax highlighting for 27 languages |
| **XSS Protection** | DOMPurify | 3.x | HTML output sanitization |
| **Logging** | Winston | 3.x | Structured logging (Daily rotation) |
| **Auth** | bcrypt | 6.x | Password hashing (Optional) |
| **Security** | helmet | 8.x | HTTP security response headers |
| **Rate Limiting** | express-rate-limit | 8.x | API rate limiting |

## 🔐 Security Architecture

### Command Filtering

AiTerm includes built-in detection rules for 6 types of high-risk commands using real-time regular expression matching:

| Category | Rule Example | Description |
|----------|---------------|-------------|
| Destructive Deletion | `/\brm\s+(-[rfRF]+\s+)?\/\s*$/m` | `rm -rf /` and variants |
| Disk Operations | `/\bdd\s+.*of=\/dev\/(sd\|hd\|nvme)/m` | `dd` writing to disk devices |
| System Control | `/\breboot\b/m` | reboot, shutdown, etc. |
| Fork Bomb | `/:\(\)\{\s*:\|:\s*&\s*\}\s*;/m` | Bash Fork Bomb |
| Dangerous Permissions | `/\bchmod\s+(-R\s+)?777\s+\/\S/m` | Root directory 777 permissions |
| Critical File Overwrite | `/\bmv\s+.*\/\s*$/m` | Moving files to root directory |

### Environment Isolation

The following sensitive environment variables are automatically filtered when the PTY process starts:

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`
- `DATABASE_URL` / `DB_PASSWORD`
- `SECRET_KEY` / `PRIVATE_KEY`
- `API_KEY` / `AUTH_TOKEN` / `PASSWORD` / `TOKEN`

### Communication Security

- WebSocket message type whitelist (7 message types).
- Shell path injection protection (prohibits path traversal and special characters).
- HTTP rate limiting (120 req/min to prevent API abuse).
- Content Security Policy (CSP).
- CORS restrictions (restricted to local access by default).

## 📊 Logging System

| Log Type | Directory | Rotation Strategy | Description |
|----------|----------|-------------------|-------------|
| App Logs | `logs/` | Daily, retain 30 days | General server operation logs |
| Audit Logs | `audit_logs/` | Daily, retain 30 days | Operation audit records |

Audit logs record the following event types:

- `SESSION_CREATE` — Session created
- `SESSION_CLOSE` — Session closed
- `AUTH_SUCCESS` — Authentication successful
- `AUTH_FAILURE` — Authentication failed
- `COMMAND_EXEC` — Command executed
- `COMMAND_BLOCKED` — Command intercepted
- `RATE_LIMIT` — Rate limit triggered

## 📄 License

[MIT License](LICENSE)
