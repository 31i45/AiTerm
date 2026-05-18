/**
 * WebSocket 消息类型定义
 * 原生 TypeScript + 运行时检查，零依赖
 */

// ─── 客户端 → 服务端 消息类型 ──────────────────────────────────────

export type ClientMessage =
  | { type: 'chat'; content: string }
  | { type: 'abort' }
  | { type: 'set_model'; model: string }
  | { type: 'clear' }
  | { type: 'tool_approve'; callId: string }
  | { type: 'tool_reject'; callId: string };

// ─── 服务端 → 客户端 消息类型 ──────────────────────────────────────

export type ServerMessage =
  | { type: 'connected'; models: string[] }
  | { type: 'chunk'; text: string }
  | { type: 'done' }
  | { type: 'error'; error: string }
  | { type: 'tool_call'; name: string; result: string }
  | { type: 'tool_confirm'; callId: string; name: string; args: Record<string, unknown> }
  | { type: 'terminal_output'; output: string }
  | { type: 'model_set'; model: string }
  | { type: 'cleared' };

// ─── 验证函数 ──────────────────────────────────────────────────────

export interface ValidationResult<T> {
  success: boolean;
  output?: T;
  issues?: string[];
}

/**
 * 验证客户端消息
 * 原生实现，零依赖
 */
export function validateClientMessage(data: unknown): ValidationResult<ClientMessage> {
  if (!data || typeof data !== 'object') {
    return { success: false, issues: ['输入必须是对象'] };
  }

  const msg = data as Record<string, unknown>;
  const type = msg.type;

  if (typeof type !== 'string') {
    return { success: false, issues: ['type 必须是字符串'] };
  }

  switch (type) {
    case 'chat': {
      const content = msg.content;
      if (typeof content !== 'string' || content.length === 0) {
        return { success: false, issues: ['content 必须是非空字符串'] };
      }
      return { success: true, output: { type: 'chat', content } };
    }

    case 'abort': {
      return { success: true, output: { type: 'abort' } };
    }

    case 'set_model': {
      const model = msg.model;
      if (typeof model !== 'string' || model.length === 0) {
        return { success: false, issues: ['model 必须是非空字符串'] };
      }
      return { success: true, output: { type: 'set_model', model } };
    }

    case 'clear': {
      return { success: true, output: { type: 'clear' } };
    }

    case 'tool_approve': {
      const callId = msg.callId;
      if (typeof callId !== 'string' || callId.length === 0) {
        return { success: false, issues: ['callId 必须是非空字符串'] };
      }
      return { success: true, output: { type: 'tool_approve', callId } };
    }

    case 'tool_reject': {
      const callId = msg.callId;
      if (typeof callId !== 'string' || callId.length === 0) {
        return { success: false, issues: ['callId 必须是非空字符串'] };
      }
      return { success: true, output: { type: 'tool_reject', callId } };
    }

    default:
      return { success: false, issues: [`未知的消息类型: ${type}`] };
  }
}
