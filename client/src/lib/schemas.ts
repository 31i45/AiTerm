/**
 * WebSocket 消息类型定义
 * 用于客户端类型检查和开发辅助
 */

// ─── 服务端 → 客户端 消息类型 ───────────────────────────────────

export interface ConnectedMessage {
  type: "connected";
  models: string[];
}

export interface ChunkMessage {
  type: "chunk";
  text: string;
}

export interface DoneMessage {
  type: "done";
}

export interface ErrorMessage {
  type: "error";
  error: string;
}

export interface ToolCallMessage {
  type: "tool_call";
  name: string;
  result: string;
}

export interface ToolConfirmMessage {
  type: "tool_confirm";
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface TerminalOutputMessage {
  type: "terminal_output";
  output: string;
}

export interface ModelSetMessage {
  type: "model_set";
  model: string;
}

export interface ClearedMessage {
  type: "cleared";
}

export type ServerMessage =
  | ConnectedMessage
  | ChunkMessage
  | DoneMessage
  | ErrorMessage
  | ToolCallMessage
  | ToolConfirmMessage
  | TerminalOutputMessage
  | ModelSetMessage
  | ClearedMessage;
