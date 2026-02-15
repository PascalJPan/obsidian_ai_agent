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
import { getVaultTools, handleVaultToolCall, OpenAITool, ALL_VAULT_TOOLS } from './tools/vaultTools';
import { ALL_WEB_TOOLS, handleWebToolCall } from './tools/webTools';
import { getActionTools, handleActionToolCall, ActionToolState, buildCustomInfoTools } from './tools/actionTools';
import { buildAgentSystemPrompt, buildAgentInitialMessage, buildFinalRoundWarning, buildStuckWarning } from './prompts/agentPrompts';
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

	// Build custom info tools and track their names for dispatch routing
	const customInfoToolDefs = buildCustomInfoTools(config.customInfoTools || []);
	const customInfoToolNames = new Set(customInfoToolDefs.map(t => t.function.name));

	// Derive tool name sets from source-of-truth arrays for dispatch routing
	const vaultToolNames = new Set(ALL_VAULT_TOOLS.map(t => t.function.name));
	const webToolNames = new Set(ALL_WEB_TOOLS.map(t => t.function.name));

	const allTools: OpenAITool[] = [
		...filterTools(getVaultTools()),
		...(config.webEnabled ? filterTools(ALL_WEB_TOOLS) : []),
		...filterTools(getActionTools(config.capabilities, config.whitelistedCommands)),
		...customInfoToolDefs
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
	let totalCachedTokens = 0;
	let lastRoundTokens = 0;
	let finished = false;
	let summary = '';
	const editsProposed: EditInstruction[] = [];

	// Stuck detection: track repeated tool calls (exact match + name-only frequency)
	const toolCallHistory: Map<string, number> = new Map();
	const toolNameFrequency: Map<string, number> = new Map();
	const TOOL_NAME_FREQUENCY_LIMIT = 8; // warn after same tool called 8+ times (any args)

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
			return buildResult(false, 'Cancelled by user', editsProposed, actionState, totalTokens, totalPromptTokens, totalCompletionTokens, totalCachedTokens, tokenPerRound, iteration - 1);
		}

		// Determine tools for this iteration
		const isLastIteration = iteration === config.maxIterations;
		const isBudgetExceeded = totalTokens >= config.maxTotalTokens;
		const shouldFinalize = isLastIteration || isBudgetExceeded;

		let currentTools: OpenAITool[];
		const finalReason = isBudgetExceeded ? 'tokens' : isLastIteration ? 'iterations' : null;
		if (shouldFinalize) {
			currentTools = filterTools(getActionTools(config.capabilities, config.whitelistedCommands, 'finalization'));
			// Inject warning with reason
			messages.push({
				role: 'user',
				content: buildFinalRoundWarning(finalReason as 'iterations' | 'tokens')
			});
		} else {
			currentTools = allTools;
		}

		const finalLabel = finalReason === 'tokens'
			? ' (FINAL — token budget)'
			: finalReason === 'iterations'
				? ' (FINAL — max iterations)'
				: '';
		callbacks.onProgress({
			type: 'iteration',
			message: `Round ${iteration}/${config.maxIterations}${finalLabel}`,
			detail: `${totalTokens.toLocaleString()} tokens used`
		});

		try {
			// API call with retry for transient errors (429/5xx)
			const MAX_RETRIES = 2;
			let data: any;
			for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
				try {
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
							// Disabled: parallel tool calls can cause stale line numbers when
							// multiple edits target the same file in one response
							parallel_tool_calls: false,
						}),
					});
					data = response.json;
					break; // Success
				} catch (reqError: any) {
					const status = reqError?.status || reqError?.response?.status;
					const isRetryable = status === 429 || (status >= 500 && status < 600);
					if (isRetryable && attempt < MAX_RETRIES) {
						const delayMs = Math.min(1000 * Math.pow(2, attempt), 4000);
						if (config.debugMode) {
							logger?.log('AGENT', `API ${status} on attempt ${attempt + 1}, retrying in ${delayMs}ms`);
						}
						callbacks.onProgress({
							type: 'tool_call',
							message: `API ${status} — retrying in ${Math.round(delayMs / 1000)}s...`
						});
						await new Promise(resolve => setTimeout(resolve, delayMs));
						continue;
					}
					throw reqError; // Not retryable or out of retries
				}
			}
			const roundTokens = data.usage?.total_tokens ?? 0;
			totalPromptTokens += data.usage?.prompt_tokens ?? 0;
			totalCompletionTokens += data.usage?.completion_tokens ?? 0;
			totalCachedTokens += data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
			tokenPerRound.push(roundTokens);
			totalTokens += roundTokens;
			lastRoundTokens = roundTokens;

			const choice = data.choices?.[0];
			if (!choice) {
				return buildResult(false, 'No response from API', editsProposed, actionState, totalTokens, totalPromptTokens, totalCompletionTokens, totalCachedTokens, tokenPerRound, iteration);
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

				// Stuck detection: exact match (same tool + same args)
				const callKey = `${fnName}:${fnArgsStr}`;
				const callCount = (toolCallHistory.get(callKey) || 0) + 1;
				toolCallHistory.set(callKey, callCount);

				// Secondary signal: tool-name-only frequency (catches varied-args loops)
				const nameCount = (toolNameFrequency.get(fnName) || 0) + 1;
				toolNameFrequency.set(fnName, nameCount);

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

				// Name-only frequency check (different args each time, same tool)
				if (nameCount >= TOOL_NAME_FREQUENCY_LIMIT && fnName !== 'edit_note' && fnName !== 'done') {
					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						content: `WARNING: You've called "${fnName}" ${nameCount} times this session (with varying arguments). This may indicate a loop. Consider using a different approach or calling done().`
					});
					// Don't skip — still execute the call, just warn
				}

				// Validate required arguments for known tools
				const missingArg = validateRequiredArgs(fnName, fnArgs);
				if (missingArg) {
					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						content: `Error: Missing required argument "${missingArg}" for tool "${fnName}".`
					});
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

				if (vaultToolNames.has(fnName)) {
					// Vault tools
					toolResult = await handleVaultToolCall(fnName, fnArgs, callbacks);
					// Track read notes
					if (fnName === 'read_note') {
						const pathsToTrack: string[] = [];
						if (fnArgs.path) pathsToTrack.push(fnArgs.path as string);
						if (Array.isArray(fnArgs.paths)) pathsToTrack.push(...(fnArgs.paths as string[]));
						for (const p of pathsToTrack) {
							if (!actionState.notesRead.includes(p)) {
								actionState.notesRead.push(p);
							}
						}
					}
				} else if (webToolNames.has(fnName)) {
					// Web tools
					toolResult = await handleWebToolCall(fnName, fnArgs, callbacks, config.webSnippetLimit || 8);
					// Track web sources for AgentResult
					if (fnName === 'web_search' && toolResult) {
						// Parse formatted results: "N. Title\n   URL\n   Snippet"
						const resultBlocks = toolResult.split(/\n\n/);
						for (const block of resultBlocks) {
							const lines = block.split('\n').map(l => l.trim());
							const titleMatch = lines[0]?.match(/^\d+\.\s+(.+)/);
							const url = lines[1] || '';
							const snippet = lines[2] || '';
							if (titleMatch && url.startsWith('http')) {
								actionState.webSources.push({
									url,
									title: titleMatch[1],
									summary: snippet
								});
							}
						}
					} else if (fnName === 'read_webpage' && fnArgs.url) {
						const url = fnArgs.url as string;
						// Extract title from "=== Title ===" format
						const titleMatch = toolResult?.match(/^=== (.+?) ===/);
						actionState.webSources.push({
							url,
							title: titleMatch ? titleMatch[1] : url,
							summary: ''
						});
					}
				} else if (customInfoToolNames.has(fnName)) {
					// Custom info tools — truncate to prevent consuming entire token budget
					const INFO_TOOL_CHAR_LIMIT = 32_000; // ~8K tokens
					if (callbacks.resolveCustomInfoTool) {
						const content = await callbacks.resolveCustomInfoTool(fnName);
						if (content == null) {
							toolResult = `Error: Could not resolve content for "${fnName}".`;
						} else if (content.length > INFO_TOOL_CHAR_LIMIT) {
							toolResult = content.substring(0, INFO_TOOL_CHAR_LIMIT) + `\n\n[... truncated at ${INFO_TOOL_CHAR_LIMIT} characters — content too large for context]`;
						} else {
							toolResult = content;
						}
					} else {
						toolResult = `Error: Custom info tool "${fnName}" is not available.`;
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
					if (fnName === 'append_to_note' && fnArgs.path) {
						editsProposed.push({
							file: fnArgs.path as string,
							position: 'end',
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
			return buildResult(false, `API error: ${errorMsg}`, editsProposed, actionState, totalTokens, totalPromptTokens, totalCompletionTokens, totalCachedTokens, tokenPerRound, iteration);
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

	return buildResult(true, summary, editsProposed, actionState, totalTokens, totalPromptTokens, totalCompletionTokens, totalCachedTokens, tokenPerRound, tokenPerRound.length);
}

// Required arguments for known tools — used for early validation
const REQUIRED_ARGS: Record<string, string[]> = {
	// read_note: validated in handler (path XOR paths)
	edit_note: ['file', 'position', 'content'],
	create_note: ['path', 'content'],
	// move_note: validated in handler (from/to XOR moves)
	// open_note: validated in handler (path XOR paths)
	search_vault: ['query'],
	delete_note: ['path'],
	append_to_note: ['path', 'content'],
	search_and_replace: ['search', 'replace'],
	update_properties: ['path', 'properties'],
	add_tags: ['path', 'tags'],
	link_notes: ['source', 'target'],
	copy_notes: ['paths'],
	web_search: ['query'],
	read_webpage: ['url'],
	done: ['summary'],
	ask_user: ['question'],
	execute_command: ['command_id'],
};

function validateRequiredArgs(toolName: string, args: Record<string, unknown>): string | null {
	const required = REQUIRED_ARGS[toolName];
	if (!required) return null;
	for (const key of required) {
		if (args[key] === undefined || args[key] === null) return key;
	}
	return null;
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
	cachedTokens: number,
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
		tokenUsage: { total: totalTokens, promptTokens, completionTokens, cachedTokens, perRound: tokenPerRound },
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
