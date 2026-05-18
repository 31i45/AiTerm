import type { ServerWebSocket } from "bun";
import { broadcastTerminalOutput } from "./ai-chat";
import { IS_WINDOWS, DEFAULT_SHELL } from "../types";

// 会话数据类型
interface SessionData {
  proc: ReturnType<typeof Bun.spawn> | null;
  terminal: ReturnType<typeof Bun.spawn>["terminal"] | null;
}

// 复用 TextDecoder（高频调用）
const decoder = new TextDecoder();

/**
 * 处理 WebSocket 终端连接
 * 使用 Bun 原生 ws.data 绑定会话数据
 */
export function handleTerminalWebSocket(ws: ServerWebSocket<unknown>): void {
  // Bun 原生方式：直接在 ws 上绑定会话数据
  ws.data = { proc: null, terminal: null } as SessionData;

  ws.send(JSON.stringify({ type: "connected" }));
}

/**
 * 启动交互式 shell
 */
export function startShell(
  ws: ServerWebSocket<unknown>,
  cols: number = 80,
  rows: number = 24,
): void {
  const session = ws.data as SessionData;

  // 如果已有进程，先关闭
  if (session.proc) {
    session.proc.kill();
    session.terminal?.close();
  }

  const homeDir = process.env.HOME
    || process.env.USERPROFILE
    || (IS_WINDOWS ? "C:\\Users\\Default" : "/root");

  const proc = Bun.spawn([DEFAULT_SHELL], {
    terminal: {
      cols,
      rows,
      data(_terminal, data) {
        const output = decoder.decode(data);
        // 安全发送：检查 ws 状态
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "output",
            data: output,
          }));
        }
        // 广播 Terminal 输出到 AI Chat
        broadcastTerminalOutput(output);
      },
    },
    env: {
      ...process.env,
      TERM: "xterm-256color",
    },
    cwd: homeDir,
  });

  session.proc = proc;
  session.terminal = proc.terminal;

  // 进程退出时安全通知前端
  proc.exited.then((code) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "exit", code }));
    }
    session.proc = null;
    session.terminal = null;
  });

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "started", pid: proc.pid }));
  }
}

/**
 * 向终端发送输入
 */
export function writeToTerminal(
  ws: ServerWebSocket<unknown>,
  data: string,
): void {
  const session = ws.data as SessionData;
  session?.terminal?.write(data);
}

/**
 * 调整终端大小
 */
export function resizeTerminal(
  ws: ServerWebSocket<unknown>,
  cols: number,
  rows: number,
): void {
  const session = ws.data as SessionData;
  session?.terminal?.resize(cols, rows);
}

/**
 * 关闭终端会话
 */
export function closeTerminal(ws: ServerWebSocket<unknown>): void {
  const session = ws.data as SessionData;
  if (session) {
    session.proc?.kill();
    session.terminal?.close();
    session.proc = null;
    session.terminal = null;
  }
}
