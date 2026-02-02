/**
 * Snoonu Agent HTTP Server
 * Provides REST API endpoints for the agent
 */

import { runShoppingAgent, createTaskStream, getTaskStatus, taskRegistry } from "./runner";

const PORT = process.env.AGENT_PORT || 3001;

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		const path = url.pathname;

		// CORS headers for development
		const corsHeaders = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		};

		// Handle OPTIONS preflight
		if (req.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		// POST /api/agent - Start new task
		if (path === "/api/agent" && req.method === "POST") {
			try {
				const body = await req.json();
				const { prompt, maxTurns = 20, model } = body;

				if (!prompt || typeof prompt !== "string") {
					return Response.json(
						{ error: "Missing or invalid 'prompt' in request body" },
						{ status: 400, headers: corsHeaders }
					);
				}

				// Start the agent task asynchronously
				const taskPromise = runShoppingAgent(prompt, {
					maxTurns,
					model,
				});

				// Get the task ID immediately
				const tasks = taskRegistry.listTasks();
				const latestTask = tasks[tasks.length - 1];

				if (!latestTask) {
					return Response.json(
						{ error: "Failed to create task" },
						{ status: 500, headers: corsHeaders }
					);
				}

				// Don't await - let it run in background
				taskPromise.catch((error) => {
					console.error("Agent task error:", error);
				});

				return Response.json(
					{
						success: true,
						taskId: latestTask.taskId,
						message: "Agent task started. Use /api/agent/stream to get updates.",
					},
					{ headers: corsHeaders }
				);
			} catch (error) {
				console.error("Error starting agent:", error);
				return Response.json(
					{
						error: error instanceof Error ? error.message : "Unknown error",
					},
					{ status: 500, headers: corsHeaders }
				);
			}
		}

		// GET /api/agent - List tasks
		if (path === "/api/agent" && req.method === "GET") {
			const tasks = taskRegistry.listTasks();
			return Response.json(
				{
					tasks: tasks.map((t) => ({
						taskId: t.taskId,
						sessionId: t.sessionId,
						complete: t.complete,
					})),
				},
				{ headers: corsHeaders }
			);
		}

		// GET /api/agent/status - Get task status
		if (path === "/api/agent/status" && req.method === "GET") {
			const taskId = url.searchParams.get("taskId");

			if (!taskId) {
				return Response.json(
					{ error: "Missing 'taskId' query parameter" },
					{ status: 400, headers: corsHeaders }
				);
			}

			const status = getTaskStatus(taskId);
			return Response.json(status, { headers: corsHeaders });
		}

		// GET /api/agent/stream - SSE stream
		if (path === "/api/agent/stream" && req.method === "GET") {
			const taskId = url.searchParams.get("taskId");

			if (!taskId) {
				return Response.json(
					{ error: "Missing 'taskId' query parameter" },
					{ status: 400, headers: corsHeaders }
				);
			}

			const status = getTaskStatus(taskId);

			if (!status.exists) {
				return Response.json(
					{ error: "Task not found" },
					{ status: 404, headers: corsHeaders }
				);
			}

			const stream = createTaskStream(taskId);

			if (!stream) {
				return Response.json(
					{ error: "Failed to create stream" },
					{ status: 500, headers: corsHeaders }
				);
			}

			return new Response(stream, {
				headers: {
					...corsHeaders,
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				},
			});
		}

		// Health check
		if (path === "/health") {
			return Response.json({ status: "ok" }, { headers: corsHeaders });
		}

		// 404 for unknown routes
		return Response.json(
			{ error: "Not found" },
			{ status: 404, headers: corsHeaders }
		);
	},
});

console.log(`🚀 Snoonu Agent Server running on http://localhost:${PORT}`);
console.log(`
Available endpoints:
  POST /api/agent         - Start new agent task
  GET  /api/agent         - List all tasks
  GET  /api/agent/status  - Get task status
  GET  /api/agent/stream  - SSE stream for task events
  GET  /health            - Health check
`);

export default server;
