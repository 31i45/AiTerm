<script lang="ts">
	import Terminal from './Terminal.svelte';

	function handleExit(code: number): void {
		// Shell exited, no action needed
	}
</script>

<div class="flex flex-col h-full">
	<!-- 顶部工具栏 -->
	<div class="flex items-center justify-between px-4 py-2 border-b border-[#44475a]">
		<div class="flex items-center gap-2">
			<span class="text-[#50fa7b] font-semibold text-sm">Terminal</span>
		</div>
	</div>

	<!-- 终端区域 — xterm.js 直接处理所有输入输出 -->
	<div class="flex-1 overflow-hidden">
		<Terminal onExit={handleExit} />
	</div>
</div>
