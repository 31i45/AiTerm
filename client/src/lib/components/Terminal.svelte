<script lang="ts">
	import { onMount } from 'svelte';
	import type { Terminal as XTerm, ITerminalOptions } from '@xterm/xterm';
	import type { FitAddon as IFitAddon } from '@xterm/addon-fit';
	import type { WebLinksAddon as IWebLinksAddon } from '@xterm/addon-web-links';
	import { createWebSocketManager, type WebSocketManager } from '$lib/utils/websocket';

	interface Props {
		onExit?: (code: number) => void;
	}

	let { onExit }: Props = $props();

	let terminalEl: HTMLDivElement;
	let term: XTerm | null = null;
	let fitAddon: IFitAddon | null = null;
	let linksAddon: IWebLinksAddon | null = null;
	let wsManager: WebSocketManager | null = null;
	let isConnected = false;
	let shellExited = false;

	onMount(async () => {
		const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
			import('@xterm/xterm'),
			import('@xterm/addon-fit'),
			import('@xterm/addon-web-links'),
		]);

		term = new Terminal({
			cursorBlink: true,
			fontFamily: '"CaskaydiaCove Nerd Font", "CaskaydiaCove NF", "JetBrainsMono Nerd Font", Consolas, "Courier New", monospace',
			fontSize: 14,
			theme: {
				background: '#282a36',
				foreground: '#f8f8f2',
				cursor: '#f8f8f2',
				selectionBackground: '#44475a',
				black: '#21222c',
				red: '#ff5555',
				green: '#50fa7b',
				yellow: '#f1fa8c',
				blue: '#bd93f9',
				magenta: '#ff79c6',
				cyan: '#8be9fd',
				white: '#f8f8f2',
				brightBlack: '#6272a4',
				brightRed: '#ff6e6e',
				brightGreen: '#69ff94',
				brightYellow: '#ffffa5',
				brightBlue: '#d6acff',
				brightMagenta: '#ff92df',
				brightCyan: '#a4ffff',
				brightWhite: '#ffffff',
			},
		} as ITerminalOptions);

		fitAddon = new FitAddon();
		term.loadAddon(fitAddon);

		linksAddon = new WebLinksAddon();
		term.loadAddon(linksAddon);

		term.open(terminalEl);
		fitAddon.fit();

		// 复制粘贴快捷键
		term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
			if (event.ctrlKey && event.shiftKey && event.key === 'C') {
				const selection = term?.getSelection();
				if (selection) {
					if (navigator.clipboard && window.isSecureContext) {
						navigator.clipboard.writeText(selection);
					} else {
						const ta = document.createElement('textarea');
						ta.value = selection;
						ta.style.position = 'fixed';
						ta.style.opacity = '0';
						document.body.appendChild(ta);
						ta.select();
						document.execCommand('copy');
						document.body.removeChild(ta);
					}
				}
				return false;
			}
			if (event.ctrlKey && event.shiftKey && event.key === 'V') {
				const readClipboard = async () => {
					let text: string;
					if (navigator.clipboard && window.isSecureContext) {
						text = await navigator.clipboard.readText();
					} else {
						text = await new Promise<string>((resolve) => {
							const ta = document.createElement('textarea');
							ta.style.position = 'fixed';
							ta.style.opacity = '0';
							document.body.appendChild(ta);
							ta.focus();
							document.execCommand('paste');
							text = ta.value;
							document.body.removeChild(ta);
							resolve(text);
						});
					}
					wsManager?.send({ type: 'input', data: text });
				};
				readClipboard();
				return false;
			}
			return true;
		});

		// 输入处理
		term.onData(handleInput);

		// 连接 WebSocket
		connectWebSocket();

		const handleResize = () => {
			fitAddon?.fit();
			sendResize();
		};

		const resizeObserver = new ResizeObserver(handleResize);
		if (terminalEl) resizeObserver.observe(terminalEl);

		window.addEventListener('resize', handleResize);

		return () => {
			window.removeEventListener('resize', handleResize);
			resizeObserver.disconnect();
			wsManager?.disconnect();
			term?.dispose();
		};
	});

	function sendResize(): void {
		wsManager?.send({
			type: 'resize',
			cols: term?.cols ?? 80,
			rows: term?.rows ?? 24,
		});
	}

	function connectWebSocket(): void {
		const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/terminal`;

		wsManager = createWebSocketManager({
			url: wsUrl,
			onOpen: () => {
				isConnected = true;
				shellExited = false;
				term?.writeln('\x1b[32m[Connected]\x1b[0m');
				wsManager?.send({
					type: 'start',
					cols: term?.cols ?? 80,
					rows: term?.rows ?? 24,
				});
			},
			onMessage: (data) => {
				handleMessage(data);
			},
			onClose: () => {
				isConnected = false;
			},
			onReconnecting: (delay) => {
				term?.writeln(`\r\n\x1b[33m[Disconnected, reconnecting in ${delay / 1000}s...]\x1b[0m`);
			},
			onMaxRetriesReached: () => {
				term?.writeln('\r\n\x1b[31m[Disconnected, max retries reached]\x1b[0m');
			},
		});

		wsManager.connect();
	}

	function handleMessage(msg: any): void {
		switch (msg.type) {
			case 'started':
				term?.writeln(`\x1b[33m[Shell started: PID ${msg.pid}]\x1b[0m\r\n`);
				break;
			case 'output':
				term?.write(msg.data);
				break;
			case 'exit':
				shellExited = true;
				term?.writeln(`\r\n\x1b[33m[Shell exited with code ${msg.code}]\x1b[0m`);
				term?.writeln('\x1b[36mPress Enter to restart...\x1b[0m');
				onExit?.(msg.code);
				break;
		}
	}

	function handleInput(data: string): void {
		if (shellExited && data === '\r') {
			shellExited = false;
			wsManager?.send({
				type: 'start',
				cols: term?.cols ?? 80,
				rows: term?.rows ?? 24,
			});
			return;
		}
		wsManager?.send({ type: 'input', data });
	}
</script>

<div bind:this={terminalEl} class="terminal-container"></div>

<style>
	.terminal-container {
		width: 100%;
		height: 100%;
	}

	:global(.xterm) {
		padding: 0;
	}

	/* 移除 xterm 的立体边框效果 */
	:global(.xterm .xterm-screen) {
		background-color: transparent !important;
	}

	:global(.xterm-selection div) {
		background-color: #44475a !important;
	}
</style>
