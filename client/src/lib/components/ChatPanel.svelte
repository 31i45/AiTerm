<script lang="ts">
	import { chatStore } from '$lib/stores/chat.svelte';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import Prism from 'prismjs';
	import 'prismjs/themes/prism-tomorrow.css';
	import 'prismjs/components/prism-bash';
	import 'prismjs/components/prism-powershell';
	import 'prismjs/components/prism-json';
	import 'prismjs/components/prism-python';
	import 'prismjs/components/prism-javascript';
	import 'prismjs/components/prism-typescript';

	// 实例级 renderer，避免全局副作用
	const renderer = new marked.Renderer();
	renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
		const language = lang || 'plaintext';
		const highlighted = Prism.languages[language]
			? Prism.highlight(text, Prism.languages[language], language)
			: text;
		const lines = highlighted.split('\n');
		const numbered = lines.map((line, i) => `<span class="line-number">${i + 1}</span>${line}`).join('\n');
		const code = encodeURIComponent(text);
		return `<div class="code-block"><div class="code-header"><span class="code-lang">${language}</span><button class="code-copy" data-code="${code}">Copy</button></div><pre class="code-body"><code>${numbered}</code></pre></div>`;
	};

	function renderContent(content: string): string {
		const raw = marked.parse(content, { renderer, async: false }) as string;
		return DOMPurify.sanitize(raw);
	}

	let inputEl: HTMLTextAreaElement;
	let inputValue = $state('');
	let messagesContainer: HTMLDivElement;
	let lastMessageContent = $state('');

	$effect(() => {
		const lastMsg = chatStore.messages.at(-1);
		const content = lastMsg?.content ?? '';
		if (content !== lastMessageContent) {
			lastMessageContent = content;
			if (messagesContainer) {
				requestAnimationFrame(() => {
					messagesContainer.scrollTop = messagesContainer.scrollHeight;
				});
			}
		}
	});

	// 复制按钮事件委托
	function handleClick(e: MouseEvent) {
		const btn = (e.target as HTMLElement).closest('.code-copy');
		if (!btn) return;
		const code = decodeURIComponent(btn.getAttribute('data-code') || '');
		navigator.clipboard.writeText(code).then(() => {
			btn.textContent = 'Copied!';
			setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
		});
	}

	function handleSend(): void {
		if (!inputValue.trim() || chatStore.isStreaming) return;
		chatStore.sendMessage(inputValue);
		inputValue = '';
		if (inputEl) inputEl.style.height = 'auto';
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}

	function handleInput(): void {
		if (inputEl) {
			inputEl.style.height = 'auto';
			inputEl.style.height = `${Math.min(inputEl.scrollHeight, 200)}px`;
		}
	}

	function formatTime(timestamp: number): string {
		return new Date(timestamp).toLocaleTimeString('zh-CN', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}
</script>

<div class="flex flex-col h-full">
	<!-- 顶部工具栏 -->
	<div class="flex items-center justify-between px-4 py-2 border-b border-[#44475a]">
		<div class="flex items-center gap-2">
			<span class="text-[#bd93f9] font-semibold text-sm">AI Chat</span>
			{#if chatStore.isStreaming}
				<span class="flex items-center gap-1 text-xs text-[#50fa7b]">
					<span class="inline-block w-1.5 h-1.5 rounded-full bg-[#50fa7b] animate-pulse"></span>
					Streaming
				</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<select
				class="bg-[#44475a] text-[#f8f8f2] text-xs rounded px-2 py-1 border border-[#6272a4] focus:outline-none focus:border-[#bd93f9] cursor-pointer"
				value={chatStore.currentModel}
				onchange={(e) => chatStore.setModel((e.target as HTMLSelectElement).value)}
				disabled={chatStore.isStreaming}
			>
				{#each chatStore.models as model}
					<option value={model.name}>{model.name}</option>
				{/each}
				{#if chatStore.models.length === 0}
					<option value={chatStore.currentModel}>{chatStore.currentModel}</option>
				{/if}
			</select>
			<button
				class="text-[#6272a4] hover:text-[#ff79c6] transition-colors text-xs px-1"
				onclick={() => chatStore.clearChat()}
				title="清空对话"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="3 6 5 6 21 6"></polyline>
					<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
				</svg>
			</button>
		</div>
	</div>

	<!-- 日志式消息列表 -->
	<div
		bind:this={messagesContainer}
		class="flex-1 overflow-y-auto p-4 font-mono text-sm"
		onclick={handleClick}
	>
		{#if chatStore.messages.length === 0}
			<div class="flex flex-col items-center justify-center h-full text-[#6272a4]">
				<p class="text-sm">输入消息开始对话</p>
				<p class="text-xs mt-1 opacity-70">支持 Shift+Enter 换行</p>
			</div>
		{:else}
			{#each chatStore.messages as message (message.id)}
				<div class="log-entry">
					<div class="log-header">
						<span class="log-role {message.role === 'user' ? 'log-user' : 'log-ai'}">
							{message.role === 'user' ? 'You' : 'AI'}
						</span>
						<span class="log-time">{formatTime(message.timestamp)}</span>
					</div>
					{#if message.role === 'user'}
						<div class="log-content">{message.content}</div>
					{:else}
						<div class="log-content markdown-body">
							{@html renderContent(message.content)}
							{#if message.isStreaming}
								<span class="streaming-cursor"></span>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		{/if}

		{#if chatStore.error}
			<div class="text-[#ff5555] px-4 py-2 text-xs">{chatStore.error}</div>
		{/if}
	</div>

	<!-- 工具确认 -->
	{#if chatStore.pendingToolConfirm}
		<div class="border-t border-[#44475a] px-4 py-3 bg-[#1e1f29]">
			<div class="flex items-center gap-2 mb-2">
				<span class="text-[#ff79c6] text-xs font-bold">🔧 AI 请求执行工具</span>
			</div>
			<div class="text-[#f8f8f2] text-xs mb-1">
				<span class="text-[#8be9fd]">{chatStore.pendingToolConfirm.name}</span>
			</div>
			<div class="text-[#6272a4] text-xs mb-3 font-mono break-all">
				{JSON.stringify(chatStore.pendingToolConfirm.args)}
			</div>
			<div class="flex gap-2">
				<button
					onclick={() => chatStore.approveTool()}
					class="px-3 py-1 bg-[#50fa7b] text-[#282a36] text-xs font-bold rounded hover:brightness-90"
				>
					✅ 允许执行
				</button>
				<button
					onclick={() => chatStore.rejectTool()}
					class="px-3 py-1 bg-[#ff5555] text-[#f8f8f2] text-xs font-bold rounded hover:brightness-90"
				>
					❌ 拒绝
				</button>
			</div>
		</div>
	{/if}

	<!-- 输入区域 -->
	<div class="border-t border-[#44475a] px-4 py-2">
		<textarea
			bind:this={inputEl}
			bind:value={inputValue}
			onkeydown={handleKeydown}
			oninput={handleInput}
			placeholder="输入消息..."
			rows="1"
			class="w-full bg-transparent text-[#f8f8f2] placeholder-[#6272a4] rounded px-0 py-0.5 text-sm resize-none focus:outline-none max-h-[200px]"
			disabled={chatStore.isStreaming}
		></textarea>
	</div>
</div>
