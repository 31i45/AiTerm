<script lang="ts">
	import '../app.css';
	// xterm.js 核心样式（必须在客户端加载，避免 SSR 问题）
	import '@xterm/xterm/css/xterm.css';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="h-screen w-screen flex flex-col overflow-hidden bg-[#282a36]">
	{@render children()}
</div>
