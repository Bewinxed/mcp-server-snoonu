/**
 * Snoonu Shopping Agent Runner
 * Executes agent tasks with the Claude Agent SDK and emits events for UI updates
 */

import { query, type SDKMessage, type Options } from "@anthropic-ai/claude-agent-sdk";
import { snoonuMcpServer } from "./tools";
import { AgentEventEmitter, taskRegistry, type AgentEvent } from "./events";

// System prompt for the shopping agent
const SHOPPING_AGENT_SYSTEM_PROMPT = `You are a helpful shopping assistant for Snoonu, a delivery platform in Qatar.

## Your Capabilities
You can help users:
1. Search for products across Snoonu merchants
2. Compare prices and find the best deals
3. Add items to their shopping cart
4. Navigate to checkout

## Available Tools
- init_session: Initialize browser session (call this first!)
- request_otp: Start login process by sending OTP to phone
- verify_otp: Complete login with OTP code
- search_products: Search for products across merchants
- add_to_cart: Add items to cart
- get_cart: View current cart contents
- checkout: Navigate to checkout page

## Important Rules
1. ALWAYS call init_session first before doing anything else
2. If the user is not logged in, guide them through the login process (request_otp -> verify_otp)
3. When searching for products, show the best options with prices
4. Always confirm with the user before adding items to cart
5. Summarize the cart contents and total before proceeding to checkout
6. Never place an order automatically - checkout just navigates to the checkout page

## Response Style
- Be concise and helpful
- Show prices in QAR
- When listing products, show: name, price, merchant, and availability
- Use tables or lists for clarity when showing multiple items
`;

export interface AgentRunnerOptions {
	/** Maximum turns for the agent */
	maxTurns?: number;
	/** Model to use */
	model?: string;
	/** Enable extended thinking */
	enableThinking?: boolean;
	/** Max thinking tokens */
	maxThinkingTokens?: number;
}

export interface AgentRunResult {
	taskId: string;
	sessionId: string;
	success: boolean;
	result?: string;
	error?: string;
	totalCost?: number;
	usage?: {
		inputTokens: number;
		outputTokens: number;
	};
}

/**
 * Run the shopping agent with a user prompt
 */
export async function runShoppingAgent(
	prompt: string,
	options: AgentRunnerOptions = {}
): Promise<AgentRunResult> {
	const {
		maxTurns = 20,
		model = "claude-sonnet-4-20250514",
		enableThinking = false,
		maxThinkingTokens = 10000,
	} = options;

	// Create task and event emitter
	const emitter = taskRegistry.createTask();
	const taskId = emitter.getTaskId();

	try {
		// Build query options
		const queryOptions: Options = {
			model,
			maxTurns,
			systemPrompt: SHOPPING_AGENT_SYSTEM_PROMPT,
			mcpServers: {
				snoonu: snoonuMcpServer,
			},
			// Only include tools from our MCP server
			allowedTools: [
				"mcp__snoonu__init_session",
				"mcp__snoonu__request_otp",
				"mcp__snoonu__verify_otp",
				"mcp__snoonu__search_products",
				"mcp__snoonu__add_to_cart",
				"mcp__snoonu__get_cart",
				"mcp__snoonu__checkout",
			],
			// Enable thinking if requested
			...(enableThinking && { maxThinkingTokens }),
			// Hook callbacks for event streaming
			hooks: {
				PreToolUse: [
					{
						hooks: [
							async (input) => {
								if (input.hook_event_name === "PreToolUse") {
									emitter.emitToolStart(
										input.tool_name,
										input.tool_input,
										`${taskId}-${Date.now()}`
									);
								}
								return { continue: true };
							},
						],
					},
				],
				PostToolUse: [
					{
						hooks: [
							async (input) => {
								if (input.hook_event_name === "PostToolUse") {
									emitter.emitToolEnd(
										input.tool_name,
										input.tool_response,
										`${taskId}-${Date.now()}`,
										true
									);
								}
								return { continue: true };
							},
						],
					},
				],
				PostToolUseFailure: [
					{
						hooks: [
							async (input) => {
								if (input.hook_event_name === "PostToolUseFailure") {
									emitter.emitToolError(
										input.tool_name,
										input.error,
										`${taskId}-${Date.now()}`
									);
								}
								return { continue: true };
							},
						],
					},
				],
				SessionStart: [
					{
						hooks: [
							async (input) => {
								if (input.hook_event_name === "SessionStart") {
									emitter.emitSessionStart(input.session_id);
								}
								return { continue: true };
							},
						],
					},
				],
			},
		};

		// Start the query
		const agentQuery = query({
			prompt,
			options: queryOptions,
		});

		let sessionId = taskId;
		let result = "";
		let totalCost = 0;
		let inputTokens = 0;
		let outputTokens = 0;

		// Process messages
		for await (const message of agentQuery) {
			await processMessage(message, emitter);

			// Track session ID and result
			if (message.type === "system" && message.subtype === "init") {
				sessionId = message.session_id;
			}

			if (message.type === "result") {
				if (message.subtype === "success") {
					result = message.result;
					totalCost = message.total_cost_usd;
					inputTokens = message.usage.input_tokens;
					outputTokens = message.usage.output_tokens;
				} else {
					// Error result
					const errors = message.errors || [];
					emitter.emitError(errors.join(", "), message.subtype);
					return {
						taskId,
						sessionId,
						success: false,
						error: errors.join(", "),
						totalCost: message.total_cost_usd,
					};
				}
			}
		}

		// Emit final result
		emitter.emitResult(true, result, totalCost, {
			inputTokens,
			outputTokens,
		});

		return {
			taskId,
			sessionId,
			success: true,
			result,
			totalCost,
			usage: {
				inputTokens,
				outputTokens,
			},
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : String(error);
		emitter.emitError(errorMessage);

		return {
			taskId,
			sessionId: taskId,
			success: false,
			error: errorMessage,
		};
	}
}

/**
 * Process a single message from the agent
 */
async function processMessage(
	message: SDKMessage,
	emitter: AgentEventEmitter
): Promise<void> {
	switch (message.type) {
		case "assistant": {
			// Extract text content from assistant message
			type TextBlock = { type: "text"; text: string };
			type ThinkingBlock = { type: "thinking"; thinking: string };
			type AnyBlock = { type: string; text?: string; thinking?: string };

			const content = message.message.content as AnyBlock[];
			const textContent = content
				.filter((block): block is TextBlock => block.type === "text" && typeof block.text === "string")
				.map((block) => block.text)
				.join("\n");

			if (textContent) {
				emitter.emitMessage("assistant", textContent);
			}

			// Check for thinking content
			const thinkingContent = content
				.filter((block): block is ThinkingBlock => block.type === "thinking" && typeof block.thinking === "string")
				.map((block) => block.thinking)
				.join("\n");

			if (thinkingContent) {
				emitter.emitThinking(thinkingContent);
			}
			break;
		}

		case "user": {
			// Extract text content from user message
			type UserTextBlock = { type: "text"; text: string };
			type UserAnyBlock = { type: string; text?: string };

			const userContent = message.message.content as UserAnyBlock[];
			const textContent = userContent
				.filter((block): block is UserTextBlock => block.type === "text" && typeof block.text === "string")
				.map((block) => block.text)
				.join("\n");

			if (textContent) {
				emitter.emitMessage("user", textContent);
			}
			break;
		}

		case "system": {
			if (message.subtype === "init") {
				emitter.emitSessionStart(message.session_id);
			}
			break;
		}

		case "result": {
			if (message.subtype === "success") {
				emitter.emitResult(true, message.result, message.total_cost_usd, {
					inputTokens: message.usage.input_tokens,
					outputTokens: message.usage.output_tokens,
				});
			} else {
				const errors = message.errors || [];
				emitter.emitError(errors.join(", "), message.subtype);
			}
			break;
		}
	}
}

/**
 * Create an SSE stream for a task
 */
export function createTaskStream(
	taskId: string
): ReadableStream<Uint8Array> | null {
	const emitter = taskRegistry.getTask(taskId);
	if (!emitter) {
		return null;
	}

	const encoder = new TextEncoder();

	return new ReadableStream({
		start(controller) {
			// Send existing event history first
			for (const event of emitter.getEventHistory()) {
				controller.enqueue(encoder.encode(AgentEventEmitter.formatSSE(event)));
			}

			// If already complete, close the stream
			if (emitter.isTaskComplete()) {
				controller.close();
				return;
			}

			// Listen for new events
			const onEvent = (event: AgentEvent) => {
				try {
					controller.enqueue(encoder.encode(AgentEventEmitter.formatSSE(event)));

					// Close stream on completion
					if (
						event.type === "result" ||
						event.type === "error" ||
						event.type === "session_end"
					) {
						controller.close();
					}
				} catch {
					// Stream closed
				}
			};

			emitter.on("event", onEvent);

			// Cleanup on close
			return () => {
				emitter.off("event", onEvent);
			};
		},
	});
}

/**
 * Get task status
 */
export function getTaskStatus(taskId: string): {
	exists: boolean;
	complete: boolean;
	sessionId: string | null;
	eventCount: number;
} {
	const emitter = taskRegistry.getTask(taskId);
	if (!emitter) {
		return {
			exists: false,
			complete: false,
			sessionId: null,
			eventCount: 0,
		};
	}

	return {
		exists: true,
		complete: emitter.isTaskComplete(),
		sessionId: emitter.getSessionId(),
		eventCount: emitter.getEventHistory().length,
	};
}

export { taskRegistry };
