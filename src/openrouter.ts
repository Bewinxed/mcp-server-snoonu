import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject, generateText, jsonSchema } from "ai";
import type { BaseSchema } from "valibot";
import { parseAsync } from "valibot";
import { toJsonSchema } from "@valibot/to-json-schema";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
	throw new Error("OPENROUTER_API_KEY is not set");
}
const openrouter = createOpenRouter({
	apiKey: OPENROUTER_API_KEY,
});

export async function queryOpenRouter<T>(
	query: string,
	schema: BaseSchema<T, any, any>,
	options?: {
		model?: string;
		temperature?: number;
		maxTokens?: number;
	}
): Promise<T> {
	const { model = "meta-llama/llama-3.2-3b-instruct", temperature = 0.7 } =
		options || {};

	// Convert Valibot schema to JSON Schema for AI SDK
	const jsonSchemaObj = toJsonSchema(schema);

	const { object, usage } = await generateObject({
		model: openrouter.chat(model),
		prompt: query,
		schema: jsonSchema(jsonSchemaObj as any),
		temperature,
		maxRetries: 2,
	});

	console.info("Usage:");
	console.table(usage);

	// Validate with original Valibot schema
	const validated = await parseAsync(schema, object);
	return validated;
}

export async function queryOpenRouterText(
	query: string,
	options?: {
		model?: string;
		temperature?: number;
		maxTokens?: number;
		systemPrompt?: string;
	}
): Promise<string> {
	const {
		model = "meta-llama/llama-3.2-3b-instruct",
		temperature = 0.7,
		systemPrompt,
	} = options || {};

	const { text } = await generateText({
		model: openrouter.chat(model),
		prompt: query,
		system: systemPrompt,
		temperature,
		maxRetries: 2,
	});

	return text;
}

export { openrouter };
