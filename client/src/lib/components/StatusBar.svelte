<script lang="ts">
	import { chatStore } from '$lib/stores/chat.svelte';

	const statusColor = $derived(
		chatStore.aiConnected ? 'bg-[#50fa7b]' : 'bg-[#ff5555]'
	);

	const statusText = $derived(
		chatStore.aiConnected ? 'Connected' : 'Disconnected'
	);

	let currentTime = $state('');

	$effect(() => {
		function updateTime(): void {
			currentTime = new Date().toLocaleTimeString('zh-CN', {
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit'
			});
		}
		updateTime();
		const interval = setInterval(updateTime, 1000);
		return () => clearInterval(interval);
	});
</script>

<div class="flex items-center justify-between px-3 h-[var(--statusbar-height)] bg-[#21222c] border-t border-[#44475a] text-xs select-none">
	<!-- 左侧信息 -->
	<div class="flex items-center gap-4">
		<!-- AI 状态 -->
		<div class="flex items-center gap-1.5">
			<span class="inline-block w-2 h-2 rounded-full {statusColor}"></span>
			<span class="text-[#6272a4]">Ollama</span>
			<span class="text-[#f8f8f2]">{statusText}</span>
		</div>

		<!-- 当前模型 -->
		<div class="flex items-center gap-1.5">
			<span class="text-[#6272a4]">Model:</span>
			<span class="text-[#bd93f9]">{chatStore.currentModel}</span>
		</div>
	</div>

	<!-- 右侧信息 -->
	<div class="flex items-center gap-4">
		<!-- 消息计数 -->
		<div class="text-[#6272a4]">
			{chatStore.messageCount} messages
		</div>

		<!-- 时间 -->
		<div class="text-[#6272a4]">
			{currentTime}
		</div>
	</div>
</div>
