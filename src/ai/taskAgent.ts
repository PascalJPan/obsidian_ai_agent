/**
 * Task Agent for ObsidianAgent Plugin
 *
 * This module handles Phase 3 of the agentic pipeline:
 * - Receives context (from Scout + Web agents or manual selection)
 * - Calls OpenAI API with task system prompt
 * - Returns structured result with edits and summary
 *
 * Pure functions with no Obsidian dependencies (except requestUrl for HTTP).
 * Vault operations (validation, insertion) stay in main.ts.
 */

import { requestUrl } from 'obsidian';
import {
	AIEditResponse,
	TokenUsage,
	AgentProgressEvent,
	TaskAgentConfig,
	TaskAgentInput,
	TaskAgentResult,
} from '../types';
import { Logger } from '../utils/logger';
import {
	buildTaskAgentSystemPrompt,
	buildMessagesFromHistory
} from './prompts';

// Re-export types for convenience
export type { TaskAgentConfig, TaskAgentInput, TaskAgentResult };

// ============================================
// Pure Functions
// ============================================

/**
 * Parse AI response to extract edits and summary
 *
 * Handles responses that are:
 * - Plain JSON
 * - JSON wrapped in markdown code blocks
 */
export function parseAIEditResponse(
	responseText: string,
	logger?: Logger
): AIEditResponse | null {
	logger?.log('PARSE', 'Parsing AI response', {
		responseLength: responseText.length,
		startsWithBackticks: responseText.trim().startsWith('```')
	});

	try {
		let jsonStr = responseText.trim();

		// Only extract from code block if the response STARTS with backticks
		// (meaning the whole response is wrapped, not just containing markdown with code blocks)
		if (jsonStr.startsWith('```')) {
			const codeBlockMatch = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```$/);
			if (codeBlockMatch) {
				jsonStr = codeBlockMatch[1].trim();
				logger?.log('PARSE', 'Extracted JSON from code block', {
					extractedLength: jsonStr.length
				});
			}
		}

		const parsed = JSON.parse(jsonStr);

		if (!parsed.edits || !Array.isArray(parsed.edits)) {
			logger?.error('PARSE', 'Invalid response structure: missing edits array', { parsed });
			return null;
		}

		logger?.log('PARSE', 'Successfully parsed response', {
			editsCount: parsed.edits.length,
			summary: parsed.summary
		});

		return {
			edits: parsed.edits,
			summary: parsed.summary || 'No summary provided'
		};
	} catch (e) {
		logger?.error('PARSE', 'JSON parse failed', {
			error: e instanceof Error ? e.message : String(e),
			rawTextPreview: responseText.substring(0, 500)
		});
		return null;
	}
}

// ============================================
// Main Agent Function
// ============================================

/**
 * Run the Task Agent
 *
 * This is the main entry point for Phase 3 of the agentic pipeline.
 * It receives context (pre-built with notes and task), calls OpenAI,
 * and returns structured results.
 *
 * Note: This does NOT validate edits against the vault or apply them.
 * That happens in main.ts after this function returns.
 */
export async function runTaskAgent(
	input: TaskAgentInput,
	config: TaskAgentConfig,
	logger?: Logger,
	onProgress?: (event: AgentProgressEvent) => void
): Promise<TaskAgentResult> {
	// Build system prompt (with pipeline context if available)
	const systemPrompt = buildTaskAgentSystemPrompt(
		config.capabilities,
		config.editableScope,
		config.customPrompts,
		input.webSources,
		input.pipelineContext
	);

	// Build messages with chat history
	const messages = buildMessagesFromHistory(
		systemPrompt,
		input.context,
		input.chatHistory,
		config.chatHistoryLength
	);

	if (config.debugMode) {
		logger?.log('API', 'Task Agent request', {
			model: config.model,
			messageCount: messages.length,
			capabilities: config.capabilities,
			editableScope: config.editableScope
		});
	}

	onProgress?.({
		type: 'iteration',
		message: 'Calling AI...',
		detail: `Model: ${config.model}`
	});

	try {
		// Call OpenAI API
		const response = await requestUrl({
			url: 'https://api.openai.com/v1/chat/completions',
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${config.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: config.model,
				response_format: { type: 'json_object' },
				messages: messages,
			}),
		});

		const data = response.json;
		const reply = data.choices?.[0]?.message?.content ?? '{}';

		// Capture token usage from API response
		const tokenUsage: TokenUsage | undefined = data.usage ? {
			promptTokens: data.usage.prompt_tokens ?? 0,
			completionTokens: data.usage.completion_tokens ?? 0,
			totalTokens: data.usage.total_tokens ?? 0
		} : undefined;

		if (config.debugMode) {
			logger?.log('API', 'Task Agent response', {
				replyLength: reply.length,
				tokenUsage
			});
		}

		// Parse response
		const editResponse = parseAIEditResponse(reply, logger);
		if (!editResponse) {
			return {
				success: false,
				edits: [],
				summary: '',
				tokenUsage,
				error: 'Failed to parse AI response as JSON'
			};
		}

		onProgress?.({
			type: 'complete',
			message: `Received ${editResponse.edits.length} edit(s)`,
			detail: editResponse.summary.substring(0, 100)
		});

		return {
			success: true,
			edits: editResponse.edits,
			summary: editResponse.summary,
			tokenUsage
		};

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger?.error('API', 'Task Agent failed', { error: errorMessage });

		return {
			success: false,
			edits: [],
			summary: '',
			error: errorMessage
		};
	}
}
