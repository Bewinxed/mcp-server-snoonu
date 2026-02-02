/**
 * POST /api/agent - Proxy to agent server
 * GET /api/agent - List tasks
 */
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || "http://localhost:3001";

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();

	const response = await fetch(`${AGENT_SERVER_URL}/api/agent`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	const data = await response.json();
	return json(data, { status: response.status });
};

export const GET: RequestHandler = async () => {
	const response = await fetch(`${AGENT_SERVER_URL}/api/agent`);
	const data = await response.json();
	return json(data);
};
