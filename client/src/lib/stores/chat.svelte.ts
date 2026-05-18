/**
 * Chat Store - AI 对话状态管理
 * 使用 Svelte 5 Runes ($state, $derived)
 */

import {
	connectAIChat, disconnectAIChat,
	approveToolCall, rejectToolCall,
	sendChatMessage, abortChat, setModel, clearChat,
	getModels, getAIStatus,
	type ModelInfo
} from '$lib/services/api';

/** 单条消息 */
export interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: number;
	isStreaming?: boolean;
}

/** 生成唯一 ID */
function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---- localStorage 持久化配置 ----

const STORAGE_KEY = 'aiterm_messages';
const MAX_STORED_MESSAGES = 100;

/** 从 localStorage 加载消息 */
export function loadMessagesFromStorage(): Message[] {
	if (typeof window === 'undefined') return [];
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) {
			const parsed = JSON.parse(saved);
			if (Array.isArray(parsed)) {
				return parsed.map((m: Message) => ({ ...m, isStreaming: false }));
			}
		}
	} catch (e) {
		console.error('[chat] Failed to load messages from storage:', e);
	}
	return [];
}

/** 保存消息到 localStorage */
export function saveMessagesToStorage(msgs: Message[]): void {
	if (typeof window === 'undefined') return;
	try {
		const messagesToStore = msgs.slice(-MAX_STORED_MESSAGES);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(messagesToStore));
	} catch (e) {
		console.error('[chat] Failed to save messages to storage:', e);
	}
}

/** 清除 localStorage 中的消息 */
export function clearMessagesFromStorage(): void {
	if (typeof window === 'undefined') return;
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch (e) {
		console.error('[chat] Failed to clear messages from storage:', e);
	}
}

/**
 * 创建聊天 store 实例
 */
export function createChatStore() {
	// ---- State ----
	let messages = $state<Message[]>([]);
	let isStreaming = $state(false);
	let error = $state<string | null>(null);
	let currentModel = $state<string>('');
	let models = $state<ModelInfo[]>([]);
	let aiConnected = $state(false);
	let terminalOutputBuffer = $state<string[]>([]);
	let pendingToolConfirm: { callId: string; name: string; args: Record<string, unknown> } | null = $state(null);

	// ---- Derived ----
	let messageCount = $derived(messages.length);

	// ---- Methods ----

	/**
	 * 设置消息列表（用于从 localStorage 恢复）
	 */
	function setMessages(msgs: Message[]): void {
		messages = msgs;
	}

	/**
	 * 更新最后一条 streaming 消息的内容
	 */
	function updateLastStreamingMessage(updater: (content: string) => string): void {
		const lastMsg = messages[messages.length - 1];
		if (lastMsg?.isStreaming) {
			lastMsg.content = updater(lastMsg.content);
		}
	}

	/**
	 * 结束最后一条 streaming 消息
	 */
	function finishLastStreamingMessage(extra?: Partial<Message>): void {
		const lastMsg = messages[messages.length - 1];
		if (lastMsg?.isStreaming) {
			messages = [...messages.slice(0, -1), { ...lastMsg, isStreaming: false, ...extra }];
		}
	}

	/**
	 * 初始化 WebSocket 连接
	 */
	function init(): void {
		connectAIChat({
			onConnected: (modelList) => {
				if (modelList.length > 0) {
					models = modelList.map(name => ({ name, model: name, modified_at: '', size: 0 }));
					currentModel = modelList[0];
					setModel(currentModel);
				}
			},
			onChunk: (chunk) => {
				updateLastStreamingMessage((content) => content + chunk);
			},
			onDone: () => {
				finishLastStreamingMessage();
				isStreaming = false;
			},
			onError: (err) => {
				finishLastStreamingMessage({ content: `Error: ${err}` });
				error = err;
				isStreaming = false;
			},
			onTerminalOutput: (output) => {
				terminalOutputBuffer = [...terminalOutputBuffer, output].slice(-50);
			},
			onToolConfirm: (callId, name, args) => {
				pendingToolConfirm = { callId, name, args };
			},
		});

		checkStatus();
	}

	/**
	 * 发送消息
	 */
	function sendMessage(content: string): void {
		if (!content.trim() || isStreaming) return;

		error = null;

		const userMessage: Message = {
			id: generateId(),
			role: 'user',
			content: content.trim(),
			timestamp: Date.now()
		};
		messages = [...messages, userMessage];

		const assistantMessage: Message = {
			id: generateId(),
			role: 'assistant',
			content: '',
			timestamp: Date.now(),
			isStreaming: true
		};
		messages = [...messages, assistantMessage];

		isStreaming = true;
		sendChatMessage(content.trim());
	}

	/**
	 * 停止当前流式响应
	 */
	function stopStreaming(): void {
		abortChat();
		isStreaming = false;
		finishLastStreamingMessage();
	}

	/**
	 * 切换模型
	 */
	function changeModel(model: string): void {
		currentModel = model;
		setModel(model);
	}

	/**
	 * 清空对话
	 */
	function resetChat(): void {
		messages = [];
		error = null;
		isStreaming = false;
		clearMessagesFromStorage();
		clearChat();
	}

	/**
	 * 加载可用模型列表
	 */
	async function loadModels(): Promise<void> {
		try {
			const modelList = await getModels();
			models = modelList;
			if (modelList.length > 0) {
				const hasCurrentModel = modelList.find((m) => m.name === currentModel);
				if (!hasCurrentModel) {
					currentModel = modelList[0].name;
				}
			}
		} catch (err) {
			console.warn('[chat] Failed to load models:', err);
			models = [];
		}
	}

	/**
	 * 检查 AI 连接状态
	 */
	async function checkStatus(): Promise<void> {
		try {
			const status = await getAIStatus();
			aiConnected = status.connected;
		} catch (err) {
			console.warn('[chat] Failed to check AI status:', err);
			aiConnected = false;
		}
	}

	/**
	 * 销毁
	 */
	function destroy(): void {
		disconnectAIChat();
	}

	/**
	 * 批准工具调用
	 */
	function approveTool(): void {
		if (pendingToolConfirm) {
			approveToolCall(pendingToolConfirm.callId);
			pendingToolConfirm = null;
		}
	}

	/**
	 * 拒绝工具调用
	 */
	function rejectTool(): void {
		if (pendingToolConfirm) {
			rejectToolCall(pendingToolConfirm.callId);
			pendingToolConfirm = null;
		}
	}

	return {
		get messages() { return messages; },
		get isStreaming() { return isStreaming; },
		get error() { return error; },
		get currentModel() { return currentModel; },
		get models() { return models; },
		get aiConnected() { return aiConnected; },
		get messageCount() { return messageCount; },
		get terminalOutput() { return terminalOutputBuffer; },
		get pendingToolConfirm() { return pendingToolConfirm; },

		setMessages,
		init,
		sendMessage,
		stopStreaming,
		setModel: changeModel,
		clearChat: resetChat,
		loadModels,
		checkStatus,
		approveTool,
		rejectTool,
		destroy
	};
}

/** 全局聊天 store 实例 */
export const chatStore = createChatStore();
