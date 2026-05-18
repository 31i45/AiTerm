/**
 * AI Chat WebSocket 处理
 * 合并：连接管理 + 流式响应 + 工具执行
 */

import type { ServerWebSocket } from "bun";
import { OLLAMA_BASE_URL } from "../types";
import { validateClientMessage, type ClientMessage } from "../schemas";
import { tools, toolDescriptions } from "../services/ai.service";

// ─── 类型定义 ──────────────────────────────────────────────────────

export interface AIChatSession {
  type: "ai-chat";
  messages: Array<{ role: string; content: string; tool_calls?: unknown[] }>;
  currentModel: string;
  abortController: AbortController | null;
  terminalOutputBuffer: string[];
  pendingToolCall: { callId: string; name: string; args: Record<string, unknown> } | null;
  pendingResolve: ((approved: boolean) => void) | null;
}

// ─── 全局状态 ──────────────────────────────────────────────────────

const MAX_OUTPUT_BUFFER = 100;
const aiChatClients = new Set<ServerWebSocket<AIChatSession>>();

// ─── 全局 Terminal 输出缓冲区（用于新连接时初始化）────────────────────

const globalTerminalOutput: string[] = [];

// ─── 模型列表获取 ──────────────────────────────────────────────────

async function getAvailableModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      return data.models?.map((m: { name: string }) => m.name) ?? [];
    }
  } catch (err) {
    console.error("[ai-chat] Failed to get models:", err);
  }
  return [];
}

// ─── 工具相关 ──────────────────────────────────────────────────────

function toOllamaTools() {
  return toolDescriptions.map((td) => ({
    type: "function" as const,
    function: {
      name: td.name,
      description: td.description,
      parameters: {
        type: "object",
        properties: td.parameters,
        required: Object.entries(td.parameters)
          .filter(([, v]) => !(v as { optional?: boolean }).optional)
          .map(([k]) => k),
      },
    },
  }));
}

async function executeToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  let result: string;
  switch (name) {
    case "execute_command": {
      const r = await tools.executeCommand(args.command as string, args.cwd as string | undefined);
      result = r.success
        ? `Exit code: ${r.exitCode}\n${r.stdout}${r.stderr ? "\nstderr: " + r.stderr : ""}`
        : `Error: ${r.stderr}`;
      break;
    }
    case "read_file": {
      const r = await tools.readFile(args.path as string);
      result = r.success ? r.content ?? "" : `Error: ${r.error}`;
      break;
    }
    case "list_directory": {
      const r = await tools.listDirectory(args.path as string);
      if (!r.success) {
        result = `Error: ${r.error}`;
      } else {
        const lines = (r.entries ?? []).map((e) =>
          `${e.isDirectory ? "📁" : "📄"} ${e.name}`
        );
        result = lines.join("\n") || r.message || "(empty)";
      }
      break;
    }
    default:
      result = `Unknown tool: ${name}`;
  }

  return result;
}

// ─── 流式响应 ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are AiTerm, an AI assistant embedded in a terminal application.

When providing code examples:
1. First explain what the code does and why
2. Then provide the code block
3. Finally explain key parts if needed

Do not start with code unless the user explicitly asks for code only.

You have access to tools. Use them when the user asks you to perform system operations.
Always respond in the same language the user uses.`;

const MAX_TOOL_ROUNDS = 5;

function buildContextMessage(session: AIChatSession): string {
  if (session.terminalOutputBuffer.length > 0) {
    const recentOutput = session.terminalOutputBuffer.slice(-20);
    return `Recent terminal output:\n${recentOutput.join("\n")}`;
  }
  return "";
}

export async function streamAIResponse(ws: ServerWebSocket<AIChatSession>): Promise<void> {
  const session = ws.data;

  const contextMessage = buildContextMessage(session);
  const messagesWithContext = contextMessage
    ? [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: `Context:\n${contextMessage}` },
        ...session.messages,
      ]
    : [
        { role: "system", content: SYSTEM_PROMPT },
        ...session.messages,
      ];

  session.abortController = new AbortController();
  let currentMessages = [...messagesWithContext];
  let useTools = true;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let ollamaResponse: Response;

    try {
      const requestBody: Record<string, unknown> = {
        model: session.currentModel,
        messages: currentMessages,
        stream: true,
      };

      if (useTools) {
        requestBody.tools = toOllamaTools();
      }

      ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: session.abortController.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return;
      }
      const msg = err instanceof Error ? err.message : "Unknown error";
      ws.send(JSON.stringify({ type: "error", error: msg }));
      return;
    }

    if (!ollamaResponse.ok) {
      const errorText = await ollamaResponse.text();

      if (ollamaResponse.status === 400 && errorText.includes("does not support tools")) {
        useTools = false;

        try {
          ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: session.currentModel,
              messages: currentMessages,
              stream: true,
            }),
            signal: session.abortController.signal,
          });
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          const msg = err instanceof Error ? err.message : "Unknown error";
          ws.send(JSON.stringify({ type: "error", error: msg }));
          return;
        }

        if (!ollamaResponse.ok) {
          ws.send(JSON.stringify({ type: "error", error: await ollamaResponse.text() }));
          return;
        }
      } else {
        ws.send(JSON.stringify({ type: "error", error: errorText }));
        return;
      }
    }

    const reader = ollamaResponse.body?.getReader();
    if (!reader) {
      ws.send(JSON.stringify({ type: "done" }));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const json = JSON.parse(trimmed);
            const content = json.message?.content ?? "";

            if (content) {
              fullContent += content;
              ws.send(JSON.stringify({ type: "chunk", text: content }));
            }

            if (json.message?.tool_calls) {
              for (const tc of json.message.tool_calls) {
                toolCalls.push({
                  name: tc.function.name,
                  arguments: typeof tc.function.arguments === "string"
                    ? JSON.parse(tc.function.arguments)
                    : tc.function.arguments,
                });
              }
            }
          } catch (e) {
            const errorMsg = `[ai-chat] Failed to parse line: ${trimmed.slice(0, 100)}`;
            console.warn(errorMsg);
            ws.send(JSON.stringify({ type: "error", error: "Stream parse error" }));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[ai-chat] Stream error:", err);
      }
    } finally {
      reader.releaseLock();
    }

    if (toolCalls.length === 0) {
      ws.send(JSON.stringify({ type: "done" }));
      return;
    }

    currentMessages.push({
      role: "assistant",
      content: fullContent,
      tool_calls: toolCalls.map((tc) => ({
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    });

    for (const tc of toolCalls) {
      // 发送确认请求给客户端，等待用户批准
      const callId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      ws.send(JSON.stringify({
        type: "tool_confirm",
        callId,
        name: tc.name,
        args: tc.arguments,
      }));

      // 等待用户确认（通过 pendingResolve 回调）
      const approved = await new Promise<boolean>((resolve) => {
        session.pendingToolCall = { callId, name: tc.name, args: tc.arguments };
        session.pendingResolve = resolve;
      });

      if (!approved) {
        currentMessages.push({ role: "tool", content: `User rejected the tool call: ${tc.name}` });
        ws.send(JSON.stringify({ type: "tool_call", name: tc.name, result: "❌ 用户拒绝了此操作" }));
        continue;
      }

      const result = await executeToolCall(tc.name, tc.arguments);
      currentMessages.push({ role: "tool", content: result });
      ws.send(JSON.stringify({ type: "tool_call", name: tc.name, result: result.slice(0, 500) }));
    }
  }

  ws.send(JSON.stringify({ type: "done" }));
}

// ─── WebSocket 处理函数 ────────────────────────────────────────────

export function handleAIChatWebSocket(ws: ServerWebSocket<unknown>): void {
  ws.data = {
    type: "ai-chat",
    messages: [],
    currentModel: "",
    abortController: null,
    terminalOutputBuffer: [...globalTerminalOutput],
  } as AIChatSession;

  aiChatClients.add(ws as ServerWebSocket<AIChatSession>);

  getAvailableModels().then((models) => {
    ws.send(JSON.stringify({ type: "connected", models }));
  });
}

export function handleAIChatMessage(ws: ServerWebSocket<unknown>, message: string): void {
  const session = ws.data as AIChatSession;

  let data: unknown;
  try {
    data = JSON.parse(message);
  } catch {
    ws.send(JSON.stringify({ type: "error", error: "Invalid JSON format" }));
    return;
  }

  const result = validateClientMessage(data);
  if (!result.success) {
    const issues = result.issues?.join(", ") ?? "Unknown error";
    ws.send(JSON.stringify({ type: "error", error: `Invalid message: ${issues}` }));
    return;
  }

  const msg = result.output as ClientMessage;

  switch (msg.type) {
    case "chat": {
      session.messages.push({ role: "user", content: msg.content });
      streamAIResponse(ws as ServerWebSocket<AIChatSession>);
      break;
    }
    case "abort": {
      session.abortController?.abort();
      break;
    }
    case "set_model": {
      session.currentModel = msg.model;
      ws.send(JSON.stringify({ type: "model_set", model: msg.model }));
      break;
    }
    case "clear": {
      session.messages = [];
      ws.send(JSON.stringify({ type: "cleared" }));
      break;
    }
    case "tool_approve": {
      if (session.pendingResolve && session.pendingToolCall?.callId === msg.callId) {
        session.pendingResolve(true);
        session.pendingToolCall = null;
        session.pendingResolve = null;
      }
      break;
    }
    case "tool_reject": {
      if (session.pendingResolve && session.pendingToolCall?.callId === msg.callId) {
        session.pendingResolve(false);
        session.pendingToolCall = null;
        session.pendingResolve = null;
      }
      break;
    }
  }
}

export function closeAIChat(ws: ServerWebSocket<unknown>): void {
  const session = ws.data as AIChatSession;
  session.abortController?.abort();
  // 清理待确认的工具调用，防止 Promise 永远挂起
  if (session.pendingResolve) {
    session.pendingResolve(false);
    session.pendingToolCall = null;
    session.pendingResolve = null;
  }
  aiChatClients.delete(ws as ServerWebSocket<AIChatSession>);
}

// ─── Terminal 输出广播 ─────────────────────────────────────────────

export function broadcastTerminalOutput(output: string): void {
  // 更新全局缓冲区（用于新连接初始化）
  globalTerminalOutput.push(output);
  if (globalTerminalOutput.length > MAX_OUTPUT_BUFFER) {
    globalTerminalOutput.shift();
  }

  // 更新每个会话的缓冲区
  for (const client of aiChatClients) {
    const session = client.data;
    session.terminalOutputBuffer.push(output);
    if (session.terminalOutputBuffer.length > MAX_OUTPUT_BUFFER) {
      session.terminalOutputBuffer.shift();
    }

    // 发送实时输出
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "terminal_output", output }));
    }
  }
}
