/**
 * 通用 WebSocket 管理工具
 * 封装重连逻辑，避免重复代码
 */

export interface WebSocketOptions {
	url: string;
	maxReconnect?: number;
	onOpen?: (ws: WebSocket) => void;
	onMessage?: (data: any) => void;
	onClose?: () => void;
	onError?: (error: Event) => void;
	onReconnecting?: (delay: number, attempt: number) => void;
	onMaxRetriesReached?: () => void;
}

export interface WebSocketManager {
	connect(): void;
	disconnect(): void;
	send(data: any): boolean;
	get readyState(): number | null;
}

export function createWebSocketManager(options: WebSocketOptions): WebSocketManager {
	let ws: WebSocket | null = null;
	let reconnectAttempts = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	const maxReconnect = options.maxReconnect ?? 5;

	function connect(): void {
		if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
			return;
		}

		ws = new WebSocket(options.url);

		ws.onopen = () => {
			reconnectAttempts = 0;
			options.onOpen?.(ws!);
		};

		ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				options.onMessage?.(data);
			} catch {
				options.onMessage?.(event.data);
			}
		};

		ws.onclose = () => {
			ws = null;
			options.onClose?.();

			// 自动重连
			if (reconnectAttempts < maxReconnect) {
				reconnectAttempts++;
				const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000);
				options.onReconnecting?.(delay, reconnectAttempts);
				reconnectTimer = setTimeout(connect, delay);
			} else {
				options.onMaxRetriesReached?.();
			}
		};

		ws.onerror = (err) => {
			options.onError?.(err);
		};
	}

	function disconnect(): void {
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		reconnectAttempts = maxReconnect;
		ws?.close();
		ws = null;
	}

	function send(data: any): boolean {
		if (ws?.readyState === WebSocket.OPEN) {
			ws.send(typeof data === 'string' ? data : JSON.stringify(data));
			return true;
		}
		return false;
	}

	return {
		connect,
		disconnect,
		send,
		get readyState() {
			return ws?.readyState ?? null;
		},
	};
}
