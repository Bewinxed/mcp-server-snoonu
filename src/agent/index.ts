/**
 * Snoonu Shopping Agent
 * Exports all agent functionality
 */

// Tools and MCP Server
export { snoonuMcpServer, tools } from "./tools";

// Runner and Task Management
export {
	runShoppingAgent,
	createTaskStream,
	getTaskStatus,
	taskRegistry,
	type AgentRunnerOptions,
	type AgentRunResult,
} from "./runner";

// Events
export {
	AgentEventEmitter,
	taskRegistry as eventRegistry,
	type AgentEvent,
	type AgentEventType,
	type SessionStartEvent,
	type SessionEndEvent,
	type MessageEvent,
	type ToolStartEvent,
	type ToolEndEvent,
	type ToolErrorEvent,
	type ThinkingEvent,
	type ResultEvent,
	type ErrorEvent,
} from "./events";

// Snoonu Client
export {
	SnoonuClient,
	getSnoonuClient,
	SNOONU_CATEGORIES,
	type CategoryName,
	type SessionData,
	type SearchResult,
	type MerchantResult,
	type ProductResult,
	type CartState,
	type CartItemState,
	type SnoonuClientConfig,
} from "../lib/snoonu";
