/**
 * Agent API Client
 * Communicates with the agent server running on the main project
 */

export interface AgentEvent {
	type: string;
	timestamp: number;
	content?: string;
	toolName?: string;
	toolInput?: unknown;
	toolOutput?: unknown;
	success?: boolean;
	error?: string;
	role?: "assistant" | "user";
	sessionId?: string;
	totalCost?: number;
	usage?: {
		inputTokens: number;
		outputTokens: number;
	};
}

export interface StartTaskResponse {
	success: boolean;
	taskId?: string;
	error?: string;
	message?: string;
}

export interface TaskStatus {
	exists: boolean;
	complete: boolean;
	sessionId: string | null;
	eventCount: number;
}

// Agent server URL - defaults to localhost:3001
const AGENT_SERVER_URL = import.meta.env.VITE_AGENT_SERVER_URL || "http://localhost:3001";

/**
 * Start a new agent task
 */
export async function startAgentTask(
	prompt: string,
	options: { maxTurns?: number; model?: string } = {}
): Promise<StartTaskResponse> {
	const response = await fetch(`${AGENT_SERVER_URL}/api/agent`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			prompt,
			...options,
		}),
	});

	return response.json();
}

/**
 * Get task status
 */
export async function getTaskStatus(taskId: string): Promise<TaskStatus> {
	const response = await fetch(`${AGENT_SERVER_URL}/api/agent/status?taskId=${taskId}`);
	return response.json();
}

/**
 * Subscribe to agent events via SSE
 */
export function subscribeToTask(
	taskId: string,
	onEvent: (event: AgentEvent) => void,
	onError?: (error: Error) => void,
	onComplete?: () => void
): () => void {
	const eventSource = new EventSource(
		`${AGENT_SERVER_URL}/api/agent/stream?taskId=${taskId}`
	);

	// Handle all event types
	const eventTypes = [
		"session_start",
		"session_end",
		"message",
		"tool_start",
		"tool_end",
		"tool_error",
		"thinking",
		"result",
		"error",
	];

	for (const type of eventTypes) {
		eventSource.addEventListener(type, (e) => {
			try {
				const data = JSON.parse(e.data);
				onEvent(data);

				// Check for completion events
				if (type === "result" || type === "error" || type === "session_end") {
					onComplete?.();
					eventSource.close();
				}
			} catch (err) {
				console.error("Failed to parse event:", err);
			}
		});
	}

	eventSource.onerror = (e) => {
		console.error("SSE error:", e);
		onError?.(new Error("Connection lost"));
		eventSource.close();
	};

	// Return cleanup function
	return () => {
		eventSource.close();
	};
}

/**
 * Extract cart items from agent events
 */
export function extractCartFromEvents(events: AgentEvent[]): {
	items: Array<{
		productId: string;
		name: string;
		quantity: number;
		unitPrice: number;
		totalPrice: number;
		available: boolean;
	}>;
	total: number;
} {
	// Find the most recent get_cart or add_to_cart result
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		if (
			event.type === "tool_end" &&
			(event.toolName?.includes("get_cart") ||
				event.toolName?.includes("add_to_cart"))
		) {
			const output = event.toolOutput as {
				content?: Array<{ type: string; text: string }>;
			};
			const textContent = output?.content?.find((c) => c.type === "text")?.text;

			if (textContent) {
				try {
					const parsed = JSON.parse(textContent);
					if (parsed.cart_items || parsed.items) {
						const items = (parsed.cart_items || parsed.items).map(
							(item: {
								product_id: string;
								name: string;
								quantity: number;
								price?: number;
								unit_price?: number;
								total?: number;
								total_price?: number;
								available?: boolean;
							}) => ({
								productId: item.product_id,
								name: item.name,
								quantity: item.quantity,
								unitPrice: item.price || item.unit_price || 0,
								totalPrice: item.total || item.total_price || 0,
								available: item.available !== false,
							})
						);

						return {
							items,
							total: parsed.cart_total || parsed.subtotal || 0,
						};
					}
				} catch {
					// Continue to next event
				}
			}
		}
	}

	return { items: [], total: 0 };
}
