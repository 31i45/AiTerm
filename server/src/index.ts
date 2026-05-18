import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import aiRoutes from "./routes/ai.routes";
import {
  handleTerminalWebSocket,
  startShell,
  writeToTerminal,
  resizeTerminal,
  closeTerminal,
} from "./routes/terminal.routes";
import {
  handleAIChatWebSocket,
  handleAIChatMessage,
  closeAIChat,
} from "./routes/ai-chat";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_WS_CONNECTIONS = 20;
let activeConnections = 0;

// ─── WebSocket 心跳配置 ────────────────────────────────────────────
// 本地局域网使用：延长心跳间隔，减少不必要的断开重连
const WS_HEARTBEAT_INTERVAL = 300_000; // 5 分钟发一次 ping
const WS_HEARTBEAT_TIMEOUT = 600_000;  // 10 分钟未收到 pong 则断开

interface WebSocketSession {
  type: string;
  lastPong: number;
  heartbeatTimer?: Timer;
}

// ─── 创建 Hono App ───────────────────────────────────────────────

const app = new Hono();

// ─── 全局中间件 ──────────────────────────────────────────────────

app.use("*", logger());

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return "*";
      const url = new URL(origin);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        return origin;
      }
      return undefined;
    },
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Type"],
    maxAge: 86400,
  }),
);

// ─── 注册路由 ────────────────────────────────────────────────────

app.route("/api/ai", aiRoutes);

// 健康检查端点
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: "2.0.0",
  });
});

// 根路径 — API 概览
app.get("/", (c) => {
  return c.json({
    name: "AiTerm Server",
    version: "2.0.0",
    endpoints: {
      health: "GET /api/health",
      aiStatus: "GET /api/ai/status",
      aiModels: "GET /api/ai/models",
      aiChat: "WebSocket /ai/chat",
      terminal: "WebSocket /terminal",
    },
  });
});

// ─── 全局错误处理 ────────────────────────────────────────────────

app.onError((err, c) => {
  console.error(`[server] Unhandled error: ${err.message}`, err);
  return c.json({ error: "Internal Server Error", message: err.message }, 500);
});

app.notFound((c) => {
  return c.json({ error: "Not Found", path: c.req.path }, 404);
});

// ─── 启动服务器 ──────────────────────────────────────────────────

console.log(`[server] Starting AiTerm Server on port ${PORT}...`);

// Bun 原生 WebSocket 升级处理
function handleWebSocketUpgrade(req: Request, server: Bun.Server): boolean {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Terminal WebSocket
  if (pathname === "/terminal") {
    const upgraded = server.upgrade(req, { data: { type: "terminal", lastPong: Date.now() } as WebSocketSession });
    if (!upgraded) console.error("[terminal] Failed to upgrade WebSocket");
    return upgraded;
  }

  // AI Chat WebSocket
  if (pathname === "/ai/chat") {
    const upgraded = server.upgrade(req, { data: { type: "ai-chat", lastPong: Date.now() } as WebSocketSession });
    if (!upgraded) console.error("[ai-chat] Failed to upgrade WebSocket");
    return upgraded;
  }

  return false; // 非 WebSocket 路径
}

// WebSocket 消息处理
function handleWebSocketMessage(ws: Bun.ServerWebSocket<unknown>, message: string) {
  const wsData = ws.data as { type: string };
  
  if (wsData?.type === "ai-chat") {
    handleAIChatMessage(ws, message);
    return;
  }

  // Terminal 消息处理
  try {
    const data = JSON.parse(message);

    switch (data.type) {
      case "start": {
        const cols = Math.max(1, Math.min(500, Math.floor(Number(data.cols) || 80)));
        const rows = Math.max(1, Math.min(200, Math.floor(Number(data.rows) || 24)));
        startShell(ws, cols, rows);
        break;
      }
      case "input":
        writeToTerminal(ws, data.data);
        break;
      case "resize":
        resizeTerminal(ws, data.cols, data.rows);
        break;
      case "close":
        closeTerminal(ws);
        break;
      default:
        console.warn(`[terminal] Unknown message type: ${data.type}`);
    }
  } catch (err) {
    console.error("[terminal] Failed to parse message:", err);
  }
}

// WebSocket 连接打开处理
function handleWebSocketOpen(ws: Bun.ServerWebSocket<WebSocketSession>) {
  activeConnections++;
  
  if (activeConnections > MAX_WS_CONNECTIONS) {
    console.warn(`[websocket] Connection rejected: too many connections (${activeConnections}/${MAX_WS_CONNECTIONS})`);
    ws.close(1013, "Too many connections");
    activeConnections--;
    return;
  }
  
  const wsData = ws.data;
  wsData.lastPong = Date.now();
  
  // 启动心跳定时器
  wsData.heartbeatTimer = setInterval(() => {
    const now = Date.now();
    const elapsed = now - wsData.lastPong;
    
    // 超过超时时间未收到 pong，断开连接
    if (elapsed > WS_HEARTBEAT_TIMEOUT) {
      console.warn(`[websocket] Heartbeat timeout, closing connection (type: ${wsData.type})`);
      ws.close(1001, "Heartbeat timeout");
      return;
    }
    
    // 发送 ping（浏览器会自动回复 pong）
    ws.ping();
  }, WS_HEARTBEAT_INTERVAL);
  
  if (wsData?.type === "ai-chat") {
    handleAIChatWebSocket(ws);
  } else {
    handleTerminalWebSocket(ws);
  }
}

// WebSocket 连接关闭处理
function handleWebSocketClose(ws: Bun.ServerWebSocket<WebSocketSession>) {
  activeConnections--;
  const wsData = ws.data;
  
  // 清理心跳定时器
  if (wsData.heartbeatTimer) {
    clearInterval(wsData.heartbeatTimer);
    wsData.heartbeatTimer = undefined;
  }
  
  if (wsData?.type === "ai-chat") {
    closeAIChat(ws);
  } else {
    closeTerminal(ws);
  }
}

// 创建 Bun 服务器（支持 HTTP + WebSocket）
const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    // 尝试 WebSocket 升级
    if (handleWebSocketUpgrade(req, server)) {
      return undefined; // 升级成功，让 Bun 处理 WebSocket
    }
    // 非 WebSocket 请求，交给 Hono 处理
    return app.fetch(req, server);
  },
  websocket: {
    open(ws) {
      handleWebSocketOpen(ws as Bun.ServerWebSocket<WebSocketSession>);
    },
    message(ws, message) {
      handleWebSocketMessage(ws as Bun.ServerWebSocket<WebSocketSession>, message as string);
    },
    close(ws) {
      handleWebSocketClose(ws as Bun.ServerWebSocket<WebSocketSession>);
    },
    pong(ws) {
      // 更新最后 pong 时间
      const wsData = (ws as Bun.ServerWebSocket<WebSocketSession>).data;
      wsData.lastPong = Date.now();
    },
  },
});

console.log(`[server] AiTerm Server v2.0.0 is running at http://localhost:${PORT}`);
console.log(`[server] WebSocket terminal: ws://localhost:${PORT}/terminal`);
console.log(`[server] WebSocket AI chat: ws://localhost:${PORT}/ai/chat`);

// 优雅关闭
async function gracefulShutdown(signal: string) {
  console.log(`\n[server] Received ${signal}, shutting down gracefully...`);
  
  // 关闭服务器（停止接受新连接）
  server.stop();
  
  console.log("[server] Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
