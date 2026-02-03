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
	AICapabilities,
	EditableScope,
	EditInstruction,
	AIEditResponse,
	ChatMessage,
	TokenUsage,
	WebSource,
	AgentProgressEvent,
	TaskAgentConfig,
	TaskAgentInput,
	TaskAgentResult
} from '../types';
import { Logger } from '../utils/logger';
import {
	CORE_EDIT_PROMPT,
	buildScopeInstruction,
	buildPositionTypes,
	buildEditRules,
	buildForbiddenActions,
	getCurrentDateString
} from './prompts';

// Re-export types for convenience
export type { TaskAgentConfig, TaskAgentInput, TaskAgentResult };

// ============================================
// Pure Functions
// ============================================

/**
 * Build system prompt for Task Agent
 *
 * Combines core prompt with dynamic sections based on capabilities and scope.
 */
export function buildTaskAgentSystemPrompt(
	capabilities: AICapabilities,
	editableScope: EditableScope,
	customPrompts?: { character?: string; edit?: string },
	webSources?: WebSource[]
): string {
	const parts: string[] = [CORE_EDIT_PROMPT];

	// Add current date so AI knows what "current" means
	parts.push(`\n\nTODAY'S DATE: ${getCurrentDateString()}`);

	// Add dynamic scope rules
	parts.push('\n\n' + buildScopeInstruction(editableScope));

	// Add dynamic position types based on capabilities
	parts.push('\n\n' + buildPositionTypes(capabilities));

	// Add general rules
	parts.push('\n\n' + buildEditRules());

	// Add forbidden actions section (explicit warnings about what will be rejected)
	const forbiddenSection = buildForbiddenActions(capabilities, editableScope);
	if (forbiddenSection) {
		parts.push(forbiddenSection);
	}

	// Add user customizations
	if (customPrompts?.character?.trim()) {
		parts.push('\n\n--- Character Instructions ---');
		parts.push(customPrompts.character);
	}

	if (customPrompts?.edit?.trim()) {
		parts.push('\n\n--- Edit Style Instructions ---');
		parts.push(customPrompts.edit);
	}

	// Add web citation instructions if web sources present
	if (webSources && webSources.length > 0) {
		parts.push('\n\n--- Web Sources ---');
		parts.push('You have access to web research results in the context. When using information from web sources, cite them at the end of your response using markdown links: [Title](url)');
	}

	return parts.join('\n');
}

/**
 * Build messages array for OpenAI API including chat history
 *
 * Creates a messages array with:
 * - System prompt
 * - Previous chat history (with rich context about edits, files, results)
 * - Current context/request
 */
export function buildMessagesFromHistory(
	systemPrompt: string,
	currentContext: string,
	chatHistory: ChatMessage[],
	historyLength: number
): Array<{ role: string; content: string }> {
	const messages: Array<{ role: string; content: string }> = [
		{ role: 'system', content: systemPrompt }
	];

	// Add chat history (up to historyLength)
	if (historyLength > 0 && chatHistory.length > 1) {
		// Get messages except the most recent one (which is the current user message)
		const historyMessages = chatHistory.slice(0, -1).slice(-historyLength);

		for (const msg of historyMessages) {
			// Handle context-switch messages
			if (msg.type === 'context-switch') {
				messages.push({
					role: 'system',
					content: `[CONTEXT SWITCH: User navigated to note "${msg.content}" (${msg.activeFile}). Messages after this point refer to this note as the active context.]`
				});
				continue;
			}

			// Build rich context for the message
			let messageContent = '';

			if (msg.role === 'user') {
				// Include active file context for user messages
				if (msg.activeFile) {
					messageContent += `[User was viewing: ${msg.activeFile}]\n`;
				}
				messageContent += msg.content;
			} else {
				// For assistant messages, include edit details
				messageContent = msg.content;

				// Add proposed edits details if present
				if (msg.proposedEdits && msg.proposedEdits.length > 0) {
					messageContent += '\n\n[EDITS I PROPOSED:]\n';
					for (const edit of msg.proposedEdits) {
						messageContent += `- File: "${edit.file}", Position: "${edit.position}"\n`;
						messageContent += `  Content: "${edit.content.substring(0, 200)}${edit.content.length > 200 ? '...' : ''}"\n`;
					}
				}

				// Add edit results if present
				if (msg.editResults) {
					if (msg.editResults.success > 0 || msg.editResults.failed > 0) {
						messageContent += `\n[EDIT RESULTS: ${msg.editResults.success} succeeded, ${msg.editResults.failed} failed]`;
					}
					if (msg.editResults.failures.length > 0) {
						messageContent += '\n[FAILURES:]\n';
						for (const failure of msg.editResults.failures) {
							messageContent += `- "${failure.file}": ${failure.error}\n`;
						}
					}
				}
			}

			messages.push({
				role: msg.role === 'user' ? 'user' : 'assistant',
				content: messageContent
			});
		}
	}

	// Add current context/request
	messages.push({ role: 'user', content: currentContext });

	return messages;
}

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
	// Build system prompt
	const systemPrompt = buildTaskAgentSystemPrompt(
		config.capabilities,
		config.editableScope,
		config.customPrompts,
		input.webSources
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
