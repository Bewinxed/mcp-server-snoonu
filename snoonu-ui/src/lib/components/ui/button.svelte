<script lang="ts">
	import { cn } from "$lib/utils";

	interface Props {
		variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
		size?: "default" | "sm" | "lg" | "icon";
		class?: string;
		disabled?: boolean;
		type?: "button" | "submit" | "reset";
		onclick?: (e: MouseEvent) => void;
		children?: import("svelte").Snippet;
	}

	let {
		variant = "default",
		size = "default",
		class: className = "",
		disabled = false,
		type = "button",
		onclick,
		children
	}: Props = $props();

	const variants = {
		default: "bg-slate-900 text-white hover:bg-slate-800",
		destructive: "bg-red-500 text-white hover:bg-red-600",
		outline: "border border-slate-200 bg-white hover:bg-slate-100",
		secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
		ghost: "hover:bg-slate-100 hover:text-slate-900",
		link: "text-slate-900 underline-offset-4 hover:underline"
	};

	const sizes = {
		default: "h-10 px-4 py-2",
		sm: "h-9 px-3",
		lg: "h-11 px-8",
		icon: "h-10 w-10"
	};
</script>

<button
	{type}
	{disabled}
	class={cn(
		"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 disabled:pointer-events-none disabled:opacity-50",
		variants[variant],
		sizes[size],
		className
	)}
	{onclick}
>
	{@render children?.()}
</button>
