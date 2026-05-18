# AiTerm v2

[![Bun](https://img.shields.io/badge/Bun-1.0+-black?logo=bun)](https://bun.sh)
[![Svelte](https://img.shields.io/badge/Svelte-5.0+-ff3e00?logo=svelte)](https://svelte.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **本地优先、AI 驱动的智能终端** —— 在离线环境中享受 AI 辅助编程的强大能力

<img width="1751" height="1081" alt="image" src="https://github.com/user-attachments/assets/4d68fe57-ce5d-4141-9cbf-c62dac48b570" />

---

## ✨ 核心特性

| 特性 | 说明 |
|------|------|
| 🔒 **完全离线** | 零 CDN 依赖，所有资源本地加载，支持纯内网环境 |
| 🤖 **本地 AI** | 基于 Ollama，数据不出本地，隐私绝对安全 |
| ⚡ **极致性能** | Bun 原生 API + Svelte 5 Runes，毫秒级响应 |
| 🛡️ **多层安全** | 危险命令拦截 + 白名单验证 + 用户确认机制 |
| 🎨 **现代架构** | WebSocket 实时通信，流式 AI 响应，xterm.js 终端 |
| 📦 **极简依赖** | 服务端仅 1 个生产依赖（Hono），客户端 6 个核心依赖 |

---

## 🚀 快速开始

### 环境要求

- [Bun](https://bun.sh) >= 1.0.0
- [Ollama](https://ollama.ai) >= 0.1.0

### 安装 Ollama 模型

```bash
# 推荐模型（7B 参数，平衡性能与质量）
ollama pull codellama:7b-instruct

# 或其他模型
ollama pull llama3.1:8b
ollama pull qwen2.5:7b
```

### 启动应用

```bash
# 1. 克隆仓库
git clone <repository-url>
cd aiterm-v2

# 2. 安装依赖
cd server && bun install
cd ../client && bun install

# 3. 启动服务端（终端 1）
cd server
bun run dev

# 4. 启动客户端（终端 2）
cd client
bun run dev

# 5. 访问应用
open http://localhost:5173
```

---

## 🏗️ 架构设计

### 技术栈

| 层级 | 技术 | 选型理由 |
|------|------|----------|
| **运行时** | Bun | 原生 WebSocket、Spawn、File API，极致性能 |
| **服务端框架** | Hono 4.12 | 轻量、高性能、TypeScript 原生支持 |
| **前端框架** | Svelte 5 | Runes API，编译时优化，无虚拟 DOM 开销 |
| **样式方案** | Tailwind CSS 4 | 原子化 CSS，按需生成，零运行时 |
| **终端组件** | xterm.js | VS Code 同款终端，功能完整 |
| **Markdown** | marked + DOMPurify | 安全渲染，XSS 防护 |
| **代码高亮** | Prism.js | 离线可用，按需加载语言包 |

### 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端 (Browser)                       │
│  ┌──────────────────────┬──────────────────────────────────┐ │
│  │   Terminal Panel     │        AI Chat Panel             │ │
│  │   ┌──────────────┐   │   ┌──────────────────────────┐   │ │
│  │   │   xterm.js   │   │   │    Svelte 5 Components   │   │ │
│  │   │   (WebSocket)│◄──┼──►│    - Message List        │   │ │
│  │   └──────────────┘   │   │    - Code Blocks         │   │ │
│  │                      │   │    - Tool Confirm        │   │ │
│  └──────────────────────┴───┴──────────────────────────┘   │ │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket / HTTP
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      服务端 (Bun Runtime)                     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Bun.serve()                                        │    │
│  │  ├── WebSocket: /terminal  (Shell PTY)              │    │
│  │  ├── WebSocket: /ai/chat   (Ollama Stream)         │    │
│  │  └── HTTP API:  /api/*     (Status, Models)        │    │
│  └─────────────────────────────────────────────────────┘    │
│                              │                              │
│                              ▼                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Ollama API (localhost:11434)                       │    │
│  │  └── Local LLM Inference                            │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔐 安全机制

### 三层防护体系

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: 危险命令拦截 (正则匹配)                             │
│  ├── rm -rf /, rm -rf *                                    │
│  ├── format c:, mkfs.*                                     │
│  ├── dd if=/dev/zero                                       │
│  ├── shutdown, reboot, halt                                │
│  └── curl ... | bash                                       │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 命令白名单 (60+ 安全命令)                          │
│  ├── 文件操作: ls, cat, head, tail, find                   │
│  ├── 开发工具: git, npm, bun, node, python                 │
│  ├── 系统信息: ps, top, df, du, uname                      │
│  └── 网络工具: curl, wget, ping (仅信息获取)                │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 用户确认机制                                       │
│  └── AI 工具调用前弹出确认对话框，用户批准后才执行            │
└─────────────────────────────────────────────────────────────┘
```

### 路径安全

- 禁止路径遍历 (`..` 检测)
- Windows 盘符限制（仅用户主目录盘符）
- 符号链接解析规范化

### XSS 防护

- DOMPurify HTML 消毒
- marked 自定义 renderer
- 代码块属性编码

---

## ⚙️ 配置说明

### 服务端环境变量

```bash
# .env
PORT=3000                           # 服务端口
OLLAMA_BASE_URL=http://localhost:11434  # Ollama API 地址
```

### 客户端配置

客户端通过 `vite.config.ts` 配置代理：

```typescript
server: {
  proxy: {
    '/api': 'http://localhost:3000',
    '/terminal': { ws: true, target: 'ws://localhost:3000' },
    '/ai': { ws: true, target: 'ws://localhost:3000' }
  }
}
```

---

## 🧪 测试

```bash
# 服务端测试
cd server
bun test

# 客户端构建测试
cd client
bun run build
```

---

## 📁 项目结构

```
aiterm-v2/
├── server/                    # Bun 服务端
│   ├── src/
│   │   ├── index.ts          # 入口：Bun.serve() + WebSocket
│   │   ├── routes/
│   │   │   ├── ai-chat.ts    # AI Chat WebSocket 处理
│   │   │   ├── ai.routes.ts  # HTTP API 路由
│   │   │   └── terminal.routes.ts  # Terminal WebSocket
│   │   ├── services/
│   │   │   └── ai.service.ts # AI 工具 + 安全验证
│   │   ├── types.ts          # 全局类型 + 安全常量
│   │   └── schemas.ts        # 消息校验 schema
│   └── package.json          # 仅 1 个生产依赖 (hono)
│
├── client/                    # SvelteKit 客户端
│   ├── src/
│   │   ├── lib/
│   │   │   ├── components/   # Svelte 组件
│   │   │   │   ├── Terminal.svelte
│   │   │   │   ├── ChatPanel.svelte
│   │   │   │   └── CmdPanel.svelte
│   │   │   ├── stores/
│   │   │   │   └── chat.svelte.ts  # Svelte 5 Runes Store
│   │   │   ├── services/
│   │   │   │   └── api.ts    # WebSocket + HTTP API
│   │   │   └── utils/
│   │   │       └── websocket.ts    # WebSocket 管理器
│   │   ├── routes/
│   │   │   ├── +page.svelte  # 主页面
│   │   │   └── +layout.svelte
│   │   └── app.css           # Dracula 主题 + 滚动条样式
│   └── package.json          # 6 个核心依赖
│
└── README.md
```

---

## 🎯 设计原则

本项目遵循以下设计哲学：

| 原则 | 实践 |
|------|------|
| **官方原生** | Bun 原生 API，Svelte 5 Runes，不封装抽象层 |
| **最先进** | 采用最新稳定技术栈（Bun 1.0+, Svelte 5, Tailwind 4） |
| **最简单** | 函数式编程，无过度设计，代码即文档 |
| **最直接** | 扁平目录结构，最小依赖路径 |
| **最可靠** | 完整类型定义，错误处理，测试覆盖 |
| **最健壮** | 多层安全防护，边界情况处理 |
| **最高效** | 流式处理，防抖优化，心跳机制 |
| **二八定律** | 聚焦核心功能（Terminal + AI Chat），砍掉冗余 |
| **零冗余** | 服务端 1 个依赖，客户端 6 个核心依赖 |

---

## 🤝 贡献

欢迎提交 Issue 和 PR！

---

## 📄 许可证

[MIT](LICENSE) © 2024 AiTerm Contributors
