# SvelteKit 5 Agentic Shopping UI Plan

## Overview

An interactive SvelteKit 5 application that provides a chat-like interface for shopping on Snoonu. Users prompt what they want, and an AI agent shops on their behalf with real-time visual feedback.

## Tech Stack

- **Framework**: SvelteKit 5 with Svelte 5 runes
- **UI Components**: shadcn-svelte
- **Styling**: Tailwind CSS
- **Real-time Updates**: Server-Sent Events (SSE)
- **Animations**: Svelte transitions + custom CSS animations
- **State Management**: Svelte 5 runes ($state, $derived, $effect)

## Project Structure

```
src/
├── routes/
│   ├── +page.svelte              # Main shopping interface
│   ├── +layout.svelte            # App layout with sidebar
│   └── api/
│       ├── agent/
│       │   ├── +server.ts        # POST: Start agent task
│       │   └── stream/+server.ts # GET: SSE for agent updates
│       └── cart/
│           └── +server.ts        # Cart operations
├── lib/
│   ├── components/
│   │   ├── ui/                   # shadcn-svelte components
│   │   ├── chat/
│   │   │   ├── ChatInput.svelte      # Prompt input
│   │   │   ├── ChatMessage.svelte    # Message bubble
│   │   │   └── ChatContainer.svelte  # Messages list
│   │   ├── agent/
│   │   │   ├── AgentStatus.svelte    # Current action indicator
│   │   │   ├── AgentStep.svelte      # Single step visualization
│   │   │   ├── AgentTimeline.svelte  # Steps timeline
│   │   │   └── ScreenshotView.svelte # Browser screenshot display
│   │   ├── shopping/
│   │   │   ├── ProductCard.svelte    # Product display
│   │   │   ├── ProductGrid.svelte    # Search results grid
│   │   │   ├── CartSidebar.svelte    # Cart preview
│   │   │   └── CheckoutPreview.svelte # Checkout summary
│   │   └── animations/
│   │       ├── LoadingDots.svelte    # Animated loading indicator
│   │       ├── Confetti.svelte       # Success celebration
│   │       └── ShoppingBag.svelte    # Bouncing bag icon
│   ├── stores/
│   │   ├── agent.svelte.ts       # Agent state (runes)
│   │   ├── cart.svelte.ts        # Cart state
│   │   └── chat.svelte.ts        # Chat messages
│   ├── server/
│   │   └── snoonu-agent.ts       # Server-side agent integration
│   └── types/
│       └── index.ts              # Shared types
└── app.css                       # Global styles + animations
```

## Core Features

### 1. Chat Interface

```svelte
<!-- ChatInput.svelte -->
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';

  let prompt = $state('');
  let isLoading = $state(false);

  async function sendPrompt() {
    if (!prompt.trim()) return;
    isLoading = true;
    // Dispatch event or call API
  }
</script>

<div class="chat-input">
  <Textarea
    bind:value={prompt}
    placeholder="What would you like to shop for today?"
    disabled={isLoading}
  />
  <Button onclick={sendPrompt} disabled={isLoading}>
    {#if isLoading}
      <LoadingDots />
    {:else}
      Send
    {/if}
  </Button>
</div>
```

### 2. Agent Status Display

Show real-time agent actions with playful animations:

```svelte
<!-- AgentStatus.svelte -->
<script lang="ts">
  import { agentState } from '$lib/stores/agent.svelte';
  import { fly, fade } from 'svelte/transition';

  const statusIcons = {
    idle: '😴',
    searching: '🔍',
    logging_in: '🔐',
    browsing: '🌐',
    adding_to_cart: '🛒',
    checkout: '💳',
    success: '✅',
    error: '❌'
  };
</script>

<div class="agent-status" transition:fly={{ y: -20 }}>
  <span class="icon animate-bounce">{statusIcons[agentState.status]}</span>
  <span class="message">{agentState.message}</span>
  {#if agentState.screenshot}
    <ScreenshotView src={agentState.screenshot} />
  {/if}
</div>
```

### 3. Real-time Timeline

```svelte
<!-- AgentTimeline.svelte -->
<script lang="ts">
  import type { AgentStep } from '$lib/types';

  interface Props {
    steps: AgentStep[];
  }

  let { steps }: Props = $props();
</script>

<div class="timeline">
  {#each steps as step, i (step.id)}
    <div
      class="step"
      class:completed={step.status === 'completed'}
      class:active={step.status === 'active'}
      in:fly={{ x: -20, delay: i * 100 }}
    >
      <div class="step-dot" />
      <div class="step-content">
        <h4>{step.title}</h4>
        <p>{step.description}</p>
        {#if step.screenshot}
          <img src={step.screenshot} alt="Step screenshot" class="step-image" />
        {/if}
      </div>
    </div>
  {/each}
</div>
```

### 4. Product Results Display

```svelte
<!-- ProductGrid.svelte -->
<script lang="ts">
  import ProductCard from './ProductCard.svelte';
  import type { Product } from '$lib/types';

  interface Props {
    products: Product[];
    onAdd?: (product: Product) => void;
  }

  let { products, onAdd }: Props = $props();
</script>

<div class="product-grid">
  {#each products as product (product.id)}
    <ProductCard
      {product}
      onadd={() => onAdd?.(product)}
    />
  {/each}
</div>
```

### 5. Cart Sidebar

```svelte
<!-- CartSidebar.svelte -->
<script lang="ts">
  import { cartState } from '$lib/stores/cart.svelte';
  import { slide } from 'svelte/transition';

  let isOpen = $state(false);
  let total = $derived(
    cartState.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  );
</script>

{#if isOpen}
  <aside class="cart-sidebar" transition:slide={{ axis: 'x' }}>
    <h3>Your Cart</h3>
    {#each cartState.items as item (item.id)}
      <div class="cart-item">
        <img src={item.image} alt={item.name} />
        <div class="item-details">
          <span>{item.name}</span>
          <span>{item.quantity} x {item.price} QR</span>
        </div>
      </div>
    {/each}
    <div class="cart-total">
      <span>Total:</span>
      <span class="price">{total} QR</span>
    </div>
  </aside>
{/if}
```

## API Routes

### POST /api/agent

Start a new agent task:

```typescript
// +server.ts
import { json } from '@sveltejs/kit';
import { SnoonuAutomation } from '$lib/server/snoonu-agent';

export async function POST({ request }) {
  const { prompt } = await request.json();

  const taskId = crypto.randomUUID();

  // Start agent task in background
  startAgentTask(taskId, prompt);

  return json({ taskId });
}
```

### GET /api/agent/stream

Server-Sent Events for real-time updates:

```typescript
// stream/+server.ts
export function GET({ url }) {
  const taskId = url.searchParams.get('taskId');

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Subscribe to agent events
      agentEvents.on(taskId, (event) => {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
```

## State Management (Svelte 5 Runes)

```typescript
// stores/agent.svelte.ts
import type { AgentStatus, AgentStep } from '$lib/types';

export const agentState = $state({
  status: 'idle' as AgentStatus,
  message: '',
  steps: [] as AgentStep[],
  screenshot: null as string | null,
  taskId: null as string | null
});

export function updateAgentStatus(status: AgentStatus, message: string) {
  agentState.status = status;
  agentState.message = message;
}

export function addAgentStep(step: AgentStep) {
  agentState.steps = [...agentState.steps, step];
}
```

## Animations

### CSS Keyframes

```css
/* app.css */
@keyframes bounce-subtle {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 5px var(--primary); }
  50% { box-shadow: 0 0 20px var(--primary); }
}

@keyframes shopping-bag-wiggle {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-10deg); }
  75% { transform: rotate(10deg); }
}

.animate-bounce-subtle { animation: bounce-subtle 2s ease-in-out infinite; }
.animate-pulse-glow { animation: pulse-glow 1.5s ease-in-out infinite; }
.animate-wiggle { animation: shopping-bag-wiggle 0.5s ease-in-out; }
```

## User Flow

1. **User opens app** → See chat interface with prompt input
2. **User enters prompt** → "Get me milk and eggs from the cheapest store"
3. **Agent starts** → Timeline shows: "Starting agent..."
4. **Login check** → If needed, shows login status with screenshot
5. **Searching** → Shows "Searching for milk..." with animated icon
6. **Results displayed** → Product cards appear with prices and stores
7. **Adding to cart** → Animation shows items being added
8. **Cart summary** → Sidebar slides in with cart contents
9. **Checkout preview** → Shows final summary before user confirms
10. **Success** → Confetti animation, order confirmation

## Implementation Order

1. **Phase 1: Core Setup**
   - SvelteKit project setup
   - shadcn-svelte installation
   - Basic layout with chat input

2. **Phase 2: Agent Integration**
   - API routes for agent control
   - SSE for real-time updates
   - Agent state management

3. **Phase 3: UI Components**
   - Chat components
   - Agent status display
   - Product cards and grid

4. **Phase 4: Polish**
   - Animations and transitions
   - Cart sidebar
   - Checkout preview
   - Error handling

5. **Phase 5: Refinement**
   - Mobile responsiveness
   - Performance optimization
   - User preferences/settings

## Key Design Principles

1. **Transparency**: Always show what the agent is doing
2. **Control**: User can pause/stop agent at any time
3. **Playfulness**: Use animations to make shopping fun
4. **Simplicity**: One prompt input, clear visual feedback
5. **Trust**: Show real screenshots so user knows agent is working correctly
