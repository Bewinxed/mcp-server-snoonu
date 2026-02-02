/**
 * GET /api/agent/stream - Proxy SSE to agent server
 */
import type { RequestHandler } from "./$types";

const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || "http://localhost:3001";

export const GET: RequestHandler = async ({ url }) => {
	const taskId = url.searchParams.get("taskId");

	if (!taskId) {
		return new Response(
			JSON.stringify({ error: "Missing 'taskId' query parameter" }),
			{
				status: 400,
				headers: { "Content-Type": "application/json" },
			}
		);
	}

	// Proxy the SSE stream from the agent server
	const response = await fetch(
		`${AGENT_SERVER_URL}/api/agent/stream?taskId=${taskId}`
	);

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
		return new Response(JSON.stringify(errorData), {
			status: response.status,
			headers: { "Content-Type": "application/json" },
		});
	}

	// Return the SSE stream directly
	return new Response(response.body, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
};
