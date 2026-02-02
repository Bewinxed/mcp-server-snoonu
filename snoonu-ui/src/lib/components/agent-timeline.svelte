<script lang="ts">
	import Card from "./ui/card.svelte";

	interface TimelineEvent {
		type: string;
		timestamp: number;
		content?: string;
		toolName?: string;
		toolInput?: unknown;
		toolOutput?: unknown;
		success?: boolean;
		error?: string;
	}

	interface Props {
		events: TimelineEvent[];
	}

	let { events }: Props = $props();

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString();
	}

	function getEventIcon(type: string): string {
		switch (type) {
			case "session_start":
				return "🚀";
			case "session_end":
				return "🏁";
			case "message":
				return "💬";
			case "tool_start":
				return "⚙️";
			case "tool_end":
				return "✅";
			case "tool_error":
				return "❌";
			case "thinking":
				return "🤔";
			case "result":
				return "📋";
			case "error":
				return "🚨";
			default:
				return "📍";
		}
	}

	function getToolDisplayName(toolName: string): string {
		// Convert mcp__snoonu__search_products to "Search Products"
		const parts = toolName.split("__");
		const name = parts[parts.length - 1] || toolName;
		return name
			.split("_")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" ");
	}
</script>

<div class="flex-1 overflow-y-auto p-4 space-y-3">
	{#each events as event (event.timestamp)}
		<Card class="p-3">
			<div class="flex items-start gap-3">
				<span class="text-lg">{getEventIcon(event.type)}</span>
				<div class="flex-1 min-w-0">
					<div class="flex items-center justify-between gap-2">
						<span class="text-sm font-medium text-slate-900">
							{#if event.type === "message"}
								Message
							{:else if event.type === "tool_start"}
								Running: {getToolDisplayName(event.toolName || "")}
							{:else if event.type === "tool_end"}
								Completed: {getToolDisplayName(event.toolName || "")}
							{:else if event.type === "tool_error"}
								Failed: {getToolDisplayName(event.toolName || "")}
							{:else if event.type === "thinking"}
								Thinking...
							{:else if event.type === "result"}
								Result
							{:else}
								{event.type.replace(/_/g, " ")}
							{/if}
						</span>
						<span class="text-xs text-slate-500">{formatTime(event.timestamp)}</span>
					</div>

					{#if event.content}
						<p class="mt-1 text-sm text-slate-600 whitespace-pre-wrap">{event.content}</p>
					{/if}

					{#if event.type === "tool_start" && event.toolInput}
						<details class="mt-2">
							<summary class="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
								View input
							</summary>
							<pre class="mt-1 p-2 bg-slate-50 rounded text-xs overflow-x-auto">{JSON.stringify(
									event.toolInput,
									null,
									2
								)}</pre>
						</details>
					{/if}

					{#if event.type === "tool_end" && event.toolOutput}
						<details class="mt-2">
							<summary class="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
								View output
							</summary>
							<pre class="mt-1 p-2 bg-slate-50 rounded text-xs overflow-x-auto">{JSON.stringify(
									event.toolOutput,
									null,
									2
								)}</pre>
						</details>
					{/if}

					{#if event.error}
						<p class="mt-1 text-sm text-red-600">{event.error}</p>
					{/if}
				</div>
			</div>
		</Card>
	{/each}

	{#if events.length === 0}
		<div class="flex flex-col items-center justify-center h-64 text-slate-500">
			<span class="text-4xl mb-2">🛒</span>
			<p class="text-lg font-medium">Snoonu Shopping Agent</p>
			<p class="text-sm mt-1">Ask me to find products, add to cart, or checkout!</p>
			<p class="text-xs mt-4 text-slate-400">
				Example: "Find the cheapest milk and add it to my cart"
			</p>
		</div>
	{/if}
</div>
