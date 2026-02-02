/**
 * Test script for the Snoonu Shopping Agent
 * Usage: bun run src/agent/test-runner.ts "Buy milk and eggs"
 */

import { runShoppingAgent } from "./runner";

async function main() {
	const prompt = process.argv[2] || "Search for milk and show me the cheapest options";

	console.log("🛍️ Starting Snoonu Shopping Agent");
	console.log(`📝 Prompt: ${prompt}`);
	console.log("─".repeat(50));

	const result = await runShoppingAgent(prompt, {
		maxTurns: 15,
	});

	console.log("─".repeat(50));
	console.log("📊 Result:");
	console.log(`  Task ID: ${result.taskId}`);
	console.log(`  Session ID: ${result.sessionId}`);
	console.log(`  Success: ${result.success}`);

	if (result.success) {
		console.log(`  Result: ${result.result}`);
		console.log(`  Cost: $${result.totalCost?.toFixed(4)}`);
		console.log(`  Tokens: ${result.usage?.inputTokens} in / ${result.usage?.outputTokens} out`);
	} else {
		console.log(`  Error: ${result.error}`);
	}
}

main().catch(console.error);
