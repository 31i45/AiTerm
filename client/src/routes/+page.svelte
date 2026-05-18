<script lang="ts">
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	import CmdPanel from '$lib/components/CmdPanel.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import { chatStore, loadMessagesFromStorage, saveMessagesToStorage } from '$lib/stores/chat.svelte';
	import { onMount } from 'svelte';

	// 分栏拖拽状态
	let leftWidth = $state(50); // 百分比
	let isDragging = false;
	let splitContainer: HTMLDivElement;

	// 初始化 chat store - 使用 onMount 避免 $effect 重复触发
	onMount(() => {
		// 从 localStorage 恢复消息
		const savedMessages = loadMessagesFromStorage();
		if (savedMessages.length > 0) {
			chatStore.setMessages(savedMessages);
		}

		chatStore.init();

		return () => chatStore.destroy();
	});

	// 消息变化时自动保存到 localStorage（1秒防抖）
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const msgs = chatStore.messages;
		if (msgs.length > 0) {
			if (saveTimer) clearTimeout(saveTimer);
			saveTimer = setTimeout(() => saveMessagesToStorage(msgs), 1000);
		}
	});

	function startDrag(e: MouseEvent): void {
		isDragging = true;
		e.preventDefault();

		const onMouseMove = (ev: MouseEvent): void => {
			if (!isDragging || !splitContainer) return;
			const rect = splitContainer.getBoundingClientRect();
			const x = ev.clientX - rect.left;
			const percent = (x / rect.width) * 100;
			// 限制最小宽度 20%，最大宽度 80%
			leftWidth = Math.max(20, Math.min(80, percent));
		};

		const onMouseUp = (): void => {
			isDragging = false;
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
		};

		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
	}
</script>

<div class="flex flex-col h-full">
	<!-- 主内容区 -->
	<div bind:this={splitContainer} class="flex flex-1 overflow-hidden relative">
		<!-- 左侧：命令输出面板 -->
		<div
			class="h-full overflow-hidden"
			style="width: {leftWidth}%; min-width: 0;"
		>
			<CmdPanel />
		</div>

		<!-- 拖拽分割线 -->
		<button
			class="resize-handle w-1 h-full flex-shrink-0 bg-[#44475a] hover:bg-[#bd93f9] transition-colors z-10 relative"
			onmousedown={startDrag}
			aria-label="调整面板大小"
		>
			<!-- 拖拽手柄视觉指示 -->
			<div class="absolute inset-y-0 -left-1 -right-1"></div>
		</button>

		<!-- 右侧：AI 对话面板 -->
		<div
			class="h-full overflow-hidden"
			style="width: {100 - leftWidth}%; min-width: 0;"
		>
			<ChatPanel />
		</div>
	</div>

	<!-- 底部状态栏 -->
	<StatusBar />
</div>
