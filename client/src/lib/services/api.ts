/**
 * AI Chat WebSocket Client
 * 使用通用 WebSocket 管理工具
 */

import type { ServerMessage } from '$lib/schemas';
import { createWebSocketManager, type WebSocketManager } from '$lib/utils/websocket';

// ─── 消息类型定义 ──────────────────────────────────────────────────

export interface AIStatus {
	connected: boolean;
	version: string | null;
	error: string | null;
}

export interface ModelInfo {
	name: string;
	model: string;
	modified_at: string;
	size: number;
}

// ─── 回调类型 ──────────────────────────────────────────────────────

export interface AIChatCallbacks {
	onConnected?: (models: string[]) => void;
	onChunk: (chunk: string) => void;
	onDone: () => void;
	onError: (error: string) => void;
	onToolCall?: (name: string, result: string) => void;
	onToolConfirm?: (callId: string, name: string, args: Record<string, unknown>) => void;
	onTerminalOutput?: (output: string) => void;
}

// ─── WebSocket 管理器实例 ───────────────────────────────────────────

let wsManager: WebSocketManager | null = null;
let callbacks: AIChatCallbacks | null = null;

// ─── WebSocket 连接管理 ─────────────────────────────────────────────

export function connectAIChat(cb: AIChatCallbacks): void {
	callbacks = cb;

	if (wsManager?.readyState === WebSocket.OPEN) {
		return;
	}

	const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ai/chat`;

	wsManager = createWebSocketManager({
		url: wsUrl,
		onOpen: () => {},
		onMessage: (data: ServerMessage) => {
			handleMessage(data);
		},
		onClose: () => {},
		onReconnecting: () => {},
		onError: (err) => {
			console.error('[ai-chat] WebSocket error:', err);
		},
	});

	wsManager.connect();
}

export function disconnectAIChat(): void {
	wsManager?.disconnect();
	wsManager = null;
}

// ─── 消息处理 ──────────────────────────────────────────────────────

function handleMessage(msg: ServerMessage): void {
	if (!callbacks) return;

	switch (msg.type) {
		case 'connected':
			callbacks.onConnected?.(msg.models);
			break;
		case 'chunk':
			callbacks.onChunk(msg.text);
			break;
		case 'done':
			callbacks.onDone();
			break;
		case 'error':
			callbacks.onError(msg.error);
			break;
		case 'tool_call':
			callbacks.onToolCall?.(msg.name, msg.result);
			break;
		case 'tool_confirm':
			callbacks.onToolConfirm?.(msg.callId, msg.name, msg.args);
			break;
		case 'terminal_output':
			callbacks.onTerminalOutput?.(msg.output);
			break;
	}
}

// ─── 发送消息 ──────────────────────────────────────────────────────

export function sendChatMessage(content: string): void {
	wsManager?.send({ type: 'chat', content });
}

export function abortChat(): void {
	wsManager?.send({ type: 'abort' });
}

export function setModel(model: string): void {
	wsManager?.send({ type: 'set_model', model });
}

export function clearChat(): void {
	wsManager?.send({ type: 'clear' });
}

export function approveToolCall(callId: string): void {
	wsManager?.send({ type: 'tool_approve', callId });
}

export function rejectToolCall(callId: string): void {
	wsManager?.send({ type: 'tool_reject', callId });
}

// ─── AI Status & Models API (仍然使用 HTTP) ────────────────────────

const API_BASE = '/api';
const API_TIMEOUT = 10000; // 10 秒超时

export async function getAIStatus(): Promise<AIStatus> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
	try {
		const response = await fetch(`${API_BASE}/ai/status`, { signal: controller.signal });
		if (!response.ok) throw new Error(`Failed to get AI status: ${response.status}`);
		return response.json();
	} finally {
		clearTimeout(timer);
	}
}

export async function getModels(): Promise<ModelInfo[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
	try {
		const response = await fetch(`${API_BASE}/ai/models`, { signal: controller.signal });
		if (!response.ok) throw new Error(`Failed to get models: ${response.status}`);
		const data = await response.json();
		return data.models ?? [];
	} finally {
		clearTimeout(timer);
	}
}
