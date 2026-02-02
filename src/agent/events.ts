/**
 * Event Emitter for Agent SSE Streaming
 * Provides real-time updates to the frontend
 */

import { EventEmitter } from "events";

// Event types that can be emitted
export type AgentEventType =
	| "session_start"
	| "session_end"
	| "message"
	| "tool_start"
	| "tool_end"
	| "tool_error"
	| "thinking"
	| "result"
	| "error";

// Event data structures
export interface SessionStartEvent {
	type: "session_start";
	sessionId: string;
	timestamp: number;
}

export interface SessionEndEvent {
	type: "session_end";
	sessionId: string;
	success: boolean;
	totalCost?: number;
	duration?: number;
	timestamp: number;
}

export interface MessageEvent {
	type: "message";
	role: "assistant" | "user";
	content: string;
	timestamp: number;
}

export interface ToolStartEvent {
	type: "tool_start";
	toolName: string;
	toolInput: unknown;
	toolUseId: string;
	timestamp: number;
}

export interface ToolEndEvent {
	type: "tool_end";
	toolName: string;
	toolOutput: unknown;
	toolUseId: string;
	success: boolean;
	timestamp: number;
}

export interface ToolErrorEvent {
	type: "tool_error";
	toolName: string;
	error: string;
	toolUseId: string;
	timestamp: number;
}

export interface ThinkingEvent {
	type: "thinking";
	content: string;
	timestamp: number;
}

export interface ResultEvent {
	type: "result";
	success: boolean;
	result: string;
	totalCost?: number;
	usage?: {
		inputTokens: number;
		outputTokens: number;
	};
	timestamp: number;
}

export interface ErrorEvent {
	type: "error";
	error: string;
	code?: string;
	timestamp: number;
}

export type AgentEvent =
	| SessionStartEvent
	| SessionEndEvent
	| MessageEvent
	| ToolStartEvent
	| ToolEndEvent
	| ToolErrorEvent
	| ThinkingEvent
	| ResultEvent
	| ErrorEvent;

/**
 * Agent Event Emitter
 * Manages event subscriptions for a single agent task
 */
export class AgentEventEmitter extends EventEmitter {
	private taskId: string;
	private sessionId: string | null = null;
	private eventHistory: AgentEvent[] = [];
	private isComplete = false;

	constructor(taskId: string) {
		super();
		this.taskId = taskId;
	}

	/**
	 * Get task ID
	 */
	getTaskId(): string {
		return this.taskId;
	}

	/**
	 * Get session ID
	 */
	getSessionId(): string | null {
		return this.sessionId;
	}

	/**
	 * Check if task is complete
	 */
	isTaskComplete(): boolean {
		return this.isComplete;
	}

	/**
	 * Get event history
	 */
	getEventHistory(): AgentEvent[] {
		return [...this.eventHistory];
	}

	/**
	 * Emit an event and store in history
	 */
	private emitEvent(event: AgentEvent): void {
		this.eventHistory.push(event);
		this.emit("event", event);
		this.emit(event.type, event);
	}

	/**
	 * Emit session start event
	 */
	emitSessionStart(sessionId: string): void {
		this.sessionId = sessionId;
		this.emitEvent({
			type: "session_start",
			sessionId,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit session end event
	 */
	emitSessionEnd(success: boolean, totalCost?: number, duration?: number): void {
		this.isComplete = true;
		this.emitEvent({
			type: "session_end",
			sessionId: this.sessionId || this.taskId,
			success,
			totalCost,
			duration,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit message event
	 */
	emitMessage(role: "assistant" | "user", content: string): void {
		this.emitEvent({
			type: "message",
			role,
			content,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit tool start event
	 */
	emitToolStart(toolName: string, toolInput: unknown, toolUseId: string): void {
		this.emitEvent({
			type: "tool_start",
			toolName,
			toolInput,
			toolUseId,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit tool end event
	 */
	emitToolEnd(
		toolName: string,
		toolOutput: unknown,
		toolUseId: string,
		success = true
	): void {
		this.emitEvent({
			type: "tool_end",
			toolName,
			toolOutput,
			toolUseId,
			success,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit tool error event
	 */
	emitToolError(toolName: string, error: string, toolUseId: string): void {
		this.emitEvent({
			type: "tool_error",
			toolName,
			error,
			toolUseId,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit thinking event
	 */
	emitThinking(content: string): void {
		this.emitEvent({
			type: "thinking",
			content,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit result event
	 */
	emitResult(
		success: boolean,
		result: string,
		totalCost?: number,
		usage?: { inputTokens: number; outputTokens: number }
	): void {
		this.isComplete = true;
		this.emitEvent({
			type: "result",
			success,
			result,
			totalCost,
			usage,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit error event
	 */
	emitError(error: string, code?: string): void {
		this.isComplete = true;
		this.emitEvent({
			type: "error",
			error,
			code,
			timestamp: Date.now(),
		});
	}

	/**
	 * Create SSE event string
	 */
	static formatSSE(event: AgentEvent): string {
		return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
	}
}

/**
 * Global task registry
 * Manages active agent tasks and their event emitters
 */
class TaskRegistry {
	private tasks = new Map<string, AgentEventEmitter>();

	/**
	 * Create a new task
	 */
	createTask(taskId?: string): AgentEventEmitter {
		const id = taskId || crypto.randomUUID();
		const emitter = new AgentEventEmitter(id);
		this.tasks.set(id, emitter);

		// Cleanup completed tasks after 5 minutes
		emitter.on("result", () => {
			setTimeout(() => this.removeTask(id), 5 * 60 * 1000);
		});
		emitter.on("error", () => {
			setTimeout(() => this.removeTask(id), 5 * 60 * 1000);
		});

		return emitter;
	}

	/**
	 * Get a task by ID
	 */
	getTask(taskId: string): AgentEventEmitter | undefined {
		return this.tasks.get(taskId);
	}

	/**
	 * Remove a task
	 */
	removeTask(taskId: string): boolean {
		const task = this.tasks.get(taskId);
		if (task) {
			task.removeAllListeners();
			return this.tasks.delete(taskId);
		}
		return false;
	}

	/**
	 * List all active tasks
	 */
	listTasks(): Array<{ taskId: string; sessionId: string | null; complete: boolean }> {
		return Array.from(this.tasks.entries()).map(([taskId, emitter]) => ({
			taskId,
			sessionId: emitter.getSessionId(),
			complete: emitter.isTaskComplete(),
		}));
	}
}

// Export singleton registry
export const taskRegistry = new TaskRegistry();

export default AgentEventEmitter;
