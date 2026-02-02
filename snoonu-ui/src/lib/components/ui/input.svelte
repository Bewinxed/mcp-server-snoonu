<script lang="ts">
	import { cn } from "$lib/utils";

	interface Props {
		value?: string;
		placeholder?: string;
		type?: string;
		disabled?: boolean;
		class?: string;
		oninput?: (e: Event) => void;
		onkeydown?: (e: KeyboardEvent) => void;
	}

	let {
		value = $bindable(""),
		placeholder = "",
		type = "text",
		disabled = false,
		class: className = "",
		oninput,
		onkeydown
	}: Props = $props();
</script>

<input
	{type}
	{placeholder}
	{disabled}
	bind:value
	{oninput}
	{onkeydown}
	class={cn(
		"flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
		className
	)}
/>
