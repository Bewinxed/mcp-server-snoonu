<script lang="ts">
	import ChatInput from "$lib/components/chat-input.svelte";
	import AgentTimeline from "$lib/components/agent-timeline.svelte";
	import CartSidebar from "$lib/components/cart-sidebar.svelte";
	import {
		startAgentTask,
		subscribeToTask,
		extractCartFromEvents,
		type AgentEvent,
	} from "$lib/agent-client";

	// State
	let events = $state<AgentEvent[]>([]);
	let isLoading = $state(false);
	let currentTaskId = $state<string | null>(null);
	let cleanup = $state<(() => void) | null>(null);

	// Derived cart state
	let cart = $derived(extractCartFromEvents(events));

	async function handleSubmit(message: string) {
		// Reset state
		events = [];
		isLoading = true;

		// Cleanup previous subscription
		if (cleanup) {
			cleanup();
			cleanup = null;
		}

		// Add user message to timeline
		events = [
			...events,
			{
				type: "message",
				role: "user",
				content: message,
				timestamp: Date.now(),
			},
		];

		try {
			// Start agent task
			const result = await startAgentTask(message);

			if (!result.success || !result.taskId) {
				events = [
					...events,
					{
						type: "error",
						error: result.error || "Failed to start agent",
						timestamp: Date.now(),
					},
				];
				isLoading = false;
				return;
			}

			currentTaskId = result.taskId;

			// Subscribe to task events
			cleanup = subscribeToTask(
				result.taskId,
				(event) => {
					events = [...events, event];
				},
				(error) => {
					events = [
						...events,
						{
							type: "error",
							error: error.message,
							timestamp: Date.now(),
						},
					];
					isLoading = false;
				},
				() => {
					isLoading = false;
				}
			);
		} catch (error) {
			events = [
				...events,
				{
					type: "error",
					error: error instanceof Error ? error.message : "Unknown error",
					timestamp: Date.now(),
				},
			];
			isLoading = false;
		}
	}

	function handleCheckout() {
		handleSubmit("Proceed to checkout");
	}

	// Cleanup on unmount
	$effect(() => {
		return () => {
			if (cleanup) {
				cleanup();
			}
		};
	});
</script>

<div class="h-screen flex flex-col bg-slate-100">
	<!-- Header -->
	<header class="bg-white border-b border-slate-200 px-4 py-3">
		<div class="flex items-center gap-3">
			<span class="text-2xl">🛍️</span>
			<div>
				<h1 class="text-lg font-semibold text-slate-900">Snoonu Shopping Agent</h1>
				<p class="text-xs text-slate-500">Powered by Claude</p>
			</div>
			{#if isLoading}
				<span class="ml-auto text-sm text-slate-500 flex items-center gap-2">
					<span class="animate-spin">⚙️</span>
					Working...
				</span>
			{/if}
		</div>
	</header>

	<!-- Main content -->
	<div class="flex-1 flex overflow-hidden">
		<!-- Timeline -->
		<div class="flex-1 flex flex-col">
			<AgentTimeline {events} />
			<ChatInput disabled={isLoading} onsubmit={handleSubmit} />
		</div>

		<!-- Cart sidebar -->
		<CartSidebar
			items={cart.items}
			total={cart.total}
			{isLoading}
			onCheckout={handleCheckout}
		/>
	</div>
</div>
