<script lang="ts">
	import Button from "./ui/button.svelte";
	import Card from "./ui/card.svelte";

	interface CartItem {
		productId: string;
		name: string;
		quantity: number;
		unitPrice: number;
		totalPrice: number;
		available: boolean;
	}

	interface Props {
		items: CartItem[];
		total: number;
		isLoading?: boolean;
		onCheckout?: () => void;
	}

	let { items, total, isLoading = false, onCheckout }: Props = $props();
</script>

<div class="w-80 border-l border-slate-200 bg-slate-50 flex flex-col">
	<div class="p-4 border-b border-slate-200 bg-white">
		<h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2">
			<span>🛒</span>
			Cart
			{#if items.length > 0}
				<span class="text-sm font-normal text-slate-500">
					({items.reduce((sum, item) => sum + item.quantity, 0)} items)
				</span>
			{/if}
		</h2>
	</div>

	<div class="flex-1 overflow-y-auto p-4 space-y-2">
		{#if items.length === 0}
			<div class="flex flex-col items-center justify-center h-32 text-slate-400">
				<span class="text-2xl mb-2">🛒</span>
				<p class="text-sm">Cart is empty</p>
			</div>
		{:else}
			{#each items as item (item.productId)}
				<Card class="p-3">
					<div class="flex justify-between items-start">
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium text-slate-900 truncate">
								{item.name}
							</p>
							<p class="text-xs text-slate-500">
								{item.quantity} × {item.unitPrice.toFixed(2)} QAR
							</p>
						</div>
						<span class="text-sm font-semibold text-slate-900 ml-2">
							{item.totalPrice.toFixed(2)} QAR
						</span>
					</div>
					{#if !item.available}
						<p class="mt-1 text-xs text-red-500">Out of stock</p>
					{/if}
				</Card>
			{/each}
		{/if}
	</div>

	{#if items.length > 0}
		<div class="p-4 border-t border-slate-200 bg-white space-y-3">
			<div class="flex justify-between items-center">
				<span class="text-sm text-slate-600">Subtotal</span>
				<span class="text-lg font-semibold text-slate-900">{total.toFixed(2)} QAR</span>
			</div>
			<p class="text-xs text-slate-500">Delivery fee calculated at checkout</p>
			<Button class="w-full" onclick={onCheckout} disabled={isLoading}>
				{#snippet children()}
					{#if isLoading}
						<span class="animate-spin mr-2">⏳</span>
					{/if}
					Checkout
				{/snippet}
			</Button>
		</div>
	{/if}
</div>
