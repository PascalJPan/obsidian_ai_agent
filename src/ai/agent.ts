/**
 * Unified Agent - ReAct loop engine
 *
 * Replaces the Scout → Web → Task pipeline with a single agent
 * that can explore vault, search web, and take actions in one loop.
 *
 * Memory: The agent retains context through the messages array that
 * accumulates across the loop. Every tool call and result is appended,
 * so the LLM sees its full action history on each iteration.
 * Cross-session memory comes from chatHistory in AgentInput.
 */

import { requestUrl } from 'obsidian';
import {
	AgentConfig,
	AgentCallbacks,
	AgentInput,
	AgentResult,
	EditInstruction,
} from '../types';
import { Logger } from '../utils/logger';
import { getVaultTools, handleVaultToolCall, OpenAITool } from './tools/vaultTools';
import { ALL_WEB_TOOLS, handleWebToolCall } from './tools/webTools';
import { getActionTools, handleActionToolCall, ActionToolState } from './tools/actionTools';
import { buildAgentSystemPrompt, buildAgentInitialMessage, AGENT_FINAL_ROUND_WARNING, buildStuckWarning } from './prompts/agentPrompts';
import { buildMessagesFromHistory } from './prompts/chatHistory';

/**
 * Run the unified agent
 *
 * Returns when:
 * - Agent calls done()
 * - Max iterations reached
 * - Token budget exceeded
 * - API error occurs
 * - Cancelled via AbortSignal
 *
 * Note: ask_user pauses the loop via Promise (callbacks.askUser) rather than returning.
 */
export async function runAgent(
	input: AgentInput,
	config: AgentConfig,
	callbacks: AgentCallbacks,
	logger?: Logger,
	signal?: AbortSignal
): Promise<AgentResult> {
	// Build system prompt
	const systemPrompt = buildAgentSystemPrompt(config, input);

	// Build initial messages with chat history
	const initialUserMessage = buildAgentInitialMessage(input);
	const messages: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }> = buildMessagesFromHistory(
		systemPrompt,
		initialUserMessage,
		input.chatHistory,
		config.chatHistoryLength
	);

	// Build tool set, filtering out disabled tools (done and ask_user are always protected)
	const PROTECTED_TOOLS = new Set(['done', 'ask_user']);
	const disabledSet = new Set(
		(config.disabledTools || []).filter(t => !PROTECTED_TOOLS.has(t))
	);
	const filterTools = (tools: OpenAITool[]) =>
		tools.filter(t => !disabledSet.has(t.function.name));

	const allTools: OpenAITool[] = [
		...filterTools(getVaultTools()),
		...(config.webEnabled ? filterTools(ALL_WEB_TOOLS) : []),
		...filterTools(getActionTools(config.capabilities, config.whitelistedCommands))
	];

	// State tracking
	const actionState: ActionToolState = {
		webSources: [],
		notesRead: [],
		notesCopied: [],
		editsProposed: 0
	};

	const tokenPerRound: number[] = [];
	let totalTokens = 0;
	let totalPromptTokens = 0;
	let totalCompletionTokens = 0;
	let finished = false;
	let summary = '';
	const editsProposed: EditInstruction[] = [];

	// Stuck detection: track repeated tool calls
	const toolCallHistory: Map<string, number> = new Map();

	if (config.debugMode) {
		logger?.log('AGENT', 'Starting agent loop', {
			model: config.model,
			maxIterations: config.maxIterations,
			maxTokens: config.maxTotalTokens,
			toolCount: allTools.length,
			webEnabled: config.webEnabled
		});
	}

	for (let iteration = 1; iteration <= config.maxIterations && !finished; iteration++) {
		// Check cancellation
		if (signal?.aborted) {
			return buildResult(false, 'Cancelled by user', editsProposed, actionState, totalTokens, totalPromptTokens, totalCompletionTokens, tokenPerRound, iteration - 1);
		}

		// Determine tools for this iteration
		const isLastIteration = iteration === config.maxIterations;
		const isBudgetExceeded = totalTokens >= config.maxTotalTokens;
		const shouldFinalize = isLastIteration || isBudgetExceeded;

		let currentTools: OpenAITool[];
		if (shouldFinalize) {
			currentTools = filterTools(getActionTools(config.capabilities, config.whitelistedCommands, 'finalization'));
			// Inject warning
			messages.push({
				role: 'user',
				content: AGENT_FINAL_ROUND_WARNING
			});
		} else {
			currentTools = allTools;
		}

		callbacks.onProgress({
			type: 'iteration',
			message: `Round ${iteration}/${config.maxIterations}${shouldFinalize ? ' (FINAL)' : ''}`,
			detail: `${totalTokens.toLocaleString()} tokens used`
		});

		try {
			// API call
			const response = await requestUrl({
				url: 'https://api.openai.com/v1/chat/completions',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${config.apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: config.model,
					messages,
					tools: currentTools.map(t => ({ type: t.type, function: t.function })),
					parallel_tool_calls: true,
				}),
			});

			const data = response.json;
			const roundTokens = data.usage?.total_tokens ?? 0;
			totalPromptTokens += data.usage?.prompt_tokens ?? 0;
			totalCompletionTokens += data.usage?.completion_tokens ?? 0;
			tokenPerRound.push(roundTokens);
			totalTokens += roundTokens;

			const choice = data.choices?.[0];
			if (!choice) {
				return buildResult(false, 'No response from API', editsProposed, actionState, totalTokens, totalPromptTokens, totalCompletionTokens, tokenPerRound, iteration);
			}

			const assistantMessage = choice.message;

			// Add assistant message to conversation
			messages.push(assistantMessage);

			// Emit thinking event if model produced reasoning text alongside tool calls
			if (assistantMessage.content && assistantMessage.tool_calls?.length > 0) {
				callbacks.onProgress({
					type: 'thinking',
					message: 'Thinking',
					fullContent: assistantMessage.content
				});
			}

			// If no tool calls, check for text response
			if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
				// No tool calls - treat as done with the text content as summary
				const textContent = assistantMessage.content || '';
				if (textContent) {
					summary = textContent;
					finished = true;
				}
				break;
			}

			// Process tool calls
			for (const toolCall of assistantMessage.tool_calls) {
				if (signal?.aborted) break;

				const fnName = toolCall.function.name;
				const fnArgsStr = toolCall.function.arguments;
				let fnArgs: Record<string, unknown>;

				try {
					fnArgs = JSON.parse(fnArgsStr);
				} catch {
					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						content: `Error: Invalid JSON arguments: ${fnArgsStr}`
					});
					continue;
				}

				// Stuck detection
				const callKey = `${fnName}:${fnArgsStr}`;
				const callCount = (toolCallHistory.get(callKey) || 0) + 1;
				toolCallHistory.set(callKey, callCount);

				if (callCount >= 3) {
					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						content: buildStuckWarning(fnName, callCount)
					});
					// Force finalization on next round
					if (callCount >= 4) {
						messages.push({
							role: 'user',
							content: 'You appear to be stuck in a loop. Call done() now with whatever information you have.'
						});
					}
					continue;
				}

				// Guard: reject disabled tools the API may hallucinate
				if (disabledSet.has(fnName)) {
					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						content: `Error: Tool "${fnName}" is disabled. Use a different approach.`
					});
					continue;
				}

				callbacks.onProgress({
					type: 'tool_call',
					message: fnName,
					detail: summarizeArgs(fnArgs)
				});

				if (config.debugMode) {
					logger?.log('AGENT', `Tool call: ${fnName}`, fnArgs);
				}

				// Route tool call to appropriate handler
				let toolResult: string;

				if (['search_vault', 'read_note', 'list_notes', 'get_links', 'explore_structure', 'list_tags', 'get_manual_context', 'get_properties', 'get_file_info', 'find_dead_links', 'query_notes'].includes(fnName)) {
					// Vault tools
					toolResult = await handleVaultToolCall(fnName, fnArgs, callbacks);
					// Track read notes
					if (fnName === 'read_note' && fnArgs.path) {
						const path = fnArgs.path as string;
						if (!actionState.notesRead.includes(path)) {
							actionState.notesRead.push(path);
						}
					}
				} else if (['web_search', 'read_webpage'].includes(fnName)) {
					// Web tools
					toolResult = await handleWebToolCall(fnName, fnArgs, callbacks, config.webSnippetLimit || 8);
					// Track web sources
					if (fnName === 'web_search') {
						// Results are tracked implicitly in conversation
					}
				} else {
					// Action tools (edit, create, open, move, done, ask_user, delete, execute, etc.)
					const actionResult = await handleActionToolCall(fnName, fnArgs, callbacks, actionState, config.whitelistedCommands);
					toolResult = actionResult.result;

					if (actionResult.done) {
						summary = toolResult;
						finished = true;
					}

					// Track edits for the result
					if (fnName === 'edit_note' && fnArgs.file) {
						editsProposed.push({
							file: fnArgs.file as string,
							position: fnArgs.position as string,
							content: fnArgs.content as string
						});
					}
					if (fnName === 'create_note' && fnArgs.path) {
						editsProposed.push({
							file: fnArgs.path as string,
							position: 'create',
							content: fnArgs.content as string
						});
					}
				}

				// Add tool result to conversation
				messages.push({
					role: 'tool',
					tool_call_id: toolCall.id,
					content: toolResult || '(empty result)'
				});

				// Emit tool_result event for UI
				callbacks.onProgress({
					type: 'tool_result',
					message: fnName,
					fullContent: toolResult || '(empty result)'
				});

				if (config.debugMode) {
					logger?.log('AGENT', `Tool result for ${fnName}`, {
						resultLength: toolResult?.length || 0,
						preview: toolResult?.substring(0, 200)
					});
				}
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger?.error('AGENT', `API error on iteration ${iteration}`, { error: errorMsg });
			return buildResult(false, `API error: ${errorMsg}`, editsProposed, actionState, totalTokens, totalPromptTokens, totalCompletionTokens, tokenPerRound, iteration);
		}
	}

	// If we exhausted iterations without done(), use last summary or generic message
	if (!summary) {
		summary = actionState.editsProposed > 0
			? `Completed ${actionState.editsProposed} edit(s).`
			: 'Finished processing (max iterations reached).';
	}

	callbacks.onProgress({
		type: 'complete',
		message: summary.substring(0, 100),
		detail: `${totalTokens.toLocaleString()} total tokens, ${tokenPerRound.length} rounds`
	});

	return buildResult(true, summary, editsProposed, actionState, totalTokens, totalPromptTokens, totalCompletionTokens, tokenPerRound, tokenPerRound.length);
}

// Helper: build result object
function buildResult(
	success: boolean,
	summary: string,
	editsProposed: EditInstruction[],
	actionState: ActionToolState,
	totalTokens: number,
	promptTokens: number,
	completionTokens: number,
	tokenPerRound: number[],
	iterationsUsed: number
): AgentResult {
	return {
		success,
		summary,
		editsProposed,
		notesRead: actionState.notesRead,
		notesCopied: actionState.notesCopied,
		webSourcesUsed: actionState.webSources,
		tokenUsage: { total: totalTokens, promptTokens, completionTokens, perRound: tokenPerRound },
		iterationsUsed,
		error: success ? undefined : summary
	};
}

// Helper: summarize tool arguments for progress display
function summarizeArgs(args: Record<string, unknown>): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(args)) {
		if (typeof value === 'string') {
			parts.push(`${key}: "${value.length > 50 ? value.substring(0, 50) + '...' : value}"`);
		} else if (Array.isArray(value)) {
			parts.push(`${key}: [${value.length} items]`);
		} else if (value !== undefined && value !== null) {
			parts.push(`${key}: ${value}`);
		}
	}
	return parts.join(', ');
}
