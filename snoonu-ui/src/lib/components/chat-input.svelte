<script lang="ts">
	import Button from "./ui/button.svelte";
	import Input from "./ui/input.svelte";

	interface Props {
		disabled?: boolean;
		onsubmit?: (message: string) => void;
	}

	let { disabled = false, onsubmit }: Props = $props();
	let message = $state("");

	function handleSubmit() {
		if (!message.trim() || disabled) return;
		onsubmit?.(message.trim());
		message = "";
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}
</script>

<div class="flex gap-2 p-4 border-t border-slate-200 bg-white">
	<Input
		bind:value={message}
		placeholder="Ask me to find products, add to cart, checkout..."
		{disabled}
		class="flex-1"
		onkeydown={handleKeydown}
	/>
	<Button onclick={handleSubmit} {disabled}>
		{#snippet children()}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="m22 2-7 20-4-9-9-4Z" />
				<path d="M22 2 11 13" />
			</svg>
		{/snippet}
	</Button>
</div>
