import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const SERVER_PORT = process.env.SERVER_PORT || '3000';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		proxy: {
			'/terminal': {
				target: `ws://localhost:${SERVER_PORT}`,
				ws: true,
			},
			'/ai/chat': {
				target: `ws://localhost:${SERVER_PORT}`,
				ws: true,
			},
			'/api': {
				target: `http://localhost:${SERVER_PORT}`,
			},
		},
	},
});
