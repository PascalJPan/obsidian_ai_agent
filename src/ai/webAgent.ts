/**
 * Web Agent for External Research
 *
 * Phase 2 of the modular pipeline: An AI agent that searches the web
 * to gather external information when vault context is insufficient.
 *
 * Flow:
 * 1. EVALUATE: Determine if vault context can fully answer the task
 * 2. FORMULATE: Create optimized search query
 * 3. SEARCH: Get search results from API
 * 4. SELECT: Choose which URLs to fetch in full
 * 5. FETCH: Get full page content
 * 6. EXTRACT: Pull relevant information
 */

import { requestUrl } from 'obsidian';
import { webSearch, fetchPage, SearchResult, estimateTokens } from './searchApi';
import { SearchApiType, WebSource, WebAgentResult, WebAgentProgressEvent } from '../types';
import {
	TOOL_EVALUATE_CONTEXT,
	WEB_AGENT_TOOLS,
	buildWebAgentSystemPrompt,
	buildWebInitialPrompt
} from './prompts';

export interface WebAgentConfig {
	searchApi: SearchApiType;
	searchApiKey: string;
	snippetLimit: number;     // Max search results to retrieve
	fetchLimit: number;       // Max pages to fetch in full
	tokenBudget: number;      // Max tokens for web content
	model: string;            // LLM model for agent reasoning
	openaiApiKey: string;     // OpenAI API key for LLM calls
	autoSearch: boolean;      // Whether to automatically search when needed
	minFetchPages: number;    // Minimum pages to fetch (1-3)
	maxQueryRetries: number;  // Max query reformulation retries (0-2)
}

/**
 * Run the Web Agent to gather external information
 */
export async function runWebAgent(
	task: string,
	vaultContext: string,
	config: WebAgentConfig,
	onProgress: (event: WebAgentProgressEvent) => void
): Promise<WebAgentResult> {
	// Early exit if no API key
	// For OpenAI search, use the main OpenAI API key; for others, require searchApiKey
	const effectiveSearchApiKey = config.searchApi === 'openai' ? config.openaiApiKey : config.searchApiKey;
	if (!effectiveSearchApiKey) {
		return {
			searchPerformed: false,
			webContext: '',
			sources: [],
			tokensUsed: 0,
			skipReason: config.searchApi === 'openai'
				? 'No OpenAI API key configured'
				: 'No search API key configured'
		};
	}

	// Determine if auto-search mode is enabled
	const autoSearchMode = config.autoSearch;

	const systemPrompt = buildWebAgentSystemPrompt(config, autoSearchMode);
	const initialPrompt = buildWebInitialPrompt(task, vaultContext, autoSearchMode);

	const messages: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }> = [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: initialPrompt }
	];

	// State tracking
	let searchResults: SearchResult[] = [];
	let fetchedPages: Array<{ url: string; title: string; content: string; fetchedAt: string }> = [];
	let totalContentTokens = 0;  // Estimated tokens from fetched page content
	let totalApiTokens = 0;      // Actual API tokens from LLM reasoning calls
	let searchQuery: string | undefined;
	let finished = false;
	let maxIterations = 5 + config.maxQueryRetries; // Base iterations + retry allowance
	let iteration = 0;
	let queryRetryCount = 0;

	// Pipeline metadata tracking
	const searchQueries: string[] = [];
	let evaluationReasoning: string | undefined;

	// Build tools list - remove evaluate_context if auto-search mode
	const agentTools = autoSearchMode
		? WEB_AGENT_TOOLS.filter(t => t.function.name !== 'evaluate_context')
		: WEB_AGENT_TOOLS;

	onProgress({ type: autoSearchMode ? 'searching' : 'evaluating', message: autoSearchMode ? 'Auto-search enabled, searching...' : 'Evaluating vault context...' });

	while (!finished && iteration < maxIterations) {
		iteration++;

		try {
			const response = await requestUrl({
				url: 'https://api.openai.com/v1/chat/completions',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${config.openaiApiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: config.model,
					messages: messages,
					tools: agentTools,
					tool_choice: 'auto'
				}),
			});

			const data = response.json;
			totalApiTokens += data.usage?.total_tokens ?? 0;
			const assistantMessage = data.choices?.[0]?.message;

			if (!assistantMessage) {
				return {
					searchPerformed: false,
					webContext: '',
					sources: [],
					tokensUsed: totalApiTokens + totalContentTokens,
					error: {
						message: 'No response from Web Agent',
						detail: 'The LLM did not return a valid response'
					}
				};
			}

			messages.push(assistantMessage);

			// Process tool calls
			if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
				for (const toolCall of assistantMessage.tool_calls) {
					const functionCall = toolCall.function;
					const name = functionCall.name;
					let args: Record<string, unknown> = {};

					try {
						args = JSON.parse(functionCall.arguments || '{}');
					} catch {
						args = {};
					}

					let toolResult: string;

					switch (name) {
						case 'evaluate_context': {
							const sufficient = args.sufficient as boolean;
							const reasoning = args.reasoning as string;
							const searchTopics = args.searchTopics as string[] | undefined;

							// Capture evaluation reasoning for pipeline metadata
							evaluationReasoning = reasoning;

							if (sufficient) {
								onProgress({
									type: 'skipped',
									message: 'Vault context sufficient',
									detail: reasoning
								});

								return {
									searchPerformed: false,
									webContext: '',
									sources: [],
									tokensUsed: totalApiTokens,
									skipReason: reasoning,
									searchQueries,
									evaluationReasoning
								};
							}

							onProgress({
								type: 'evaluating',
								message: 'Web search needed',
								detail: reasoning
							});

							toolResult = JSON.stringify({
								status: 'search_needed',
								suggestedTopics: searchTopics
							});
							break;
						}

						case 'web_search': {
							const query = args.query as string;
							searchQuery = query;

							// Track all queries attempted
							searchQueries.push(query);

							onProgress({
								type: 'searching',
								message: `Searching: "${query}"`,
								detail: `Using ${config.searchApi}`
							});

							try {
								searchResults = await webSearch(
									query,
									config.searchApi,
									effectiveSearchApiKey,
									config.snippetLimit
								);

								onProgress({
									type: 'searching',
									message: `Found ${searchResults.length} results`,
									detail: searchResults.slice(0, 3).map(r => r.title).join(', ')
								});

								// Build response with optional reformulation hint
								const searchResponse: Record<string, unknown> = {
									results: searchResults.map(r => ({
										title: r.title,
										url: r.url,
										snippet: r.snippet
									}))
								};

								// Suggest reformulation if few results and retries available
								if (searchResults.length < 3 && queryRetryCount < config.maxQueryRetries) {
									searchResponse.suggestReformulation = true;
									searchResponse.retriesRemaining = config.maxQueryRetries - queryRetryCount;
									searchResponse.hint = 'Few results found. Consider trying a different query with synonyms, broader terms, or different phrasings.';
									queryRetryCount++;
								}

								toolResult = JSON.stringify(searchResponse);
							} catch (error) {
								const errorMsg = (error as Error).message;
								onProgress({
									type: 'error',
									message: 'Search failed',
									detail: errorMsg
								});

								toolResult = JSON.stringify({
									error: `Search failed: ${errorMsg}`,
									results: []
								});
							}
							break;
						}

						case 'select_pages': {
							let selectedUrls = args.selectedUrls as string[];
							const selectReasoning = args.reasoning as string;

							// Enforce minimum fetch pages if agent selected fewer
							let enforcedMinimum = false;
							if (selectedUrls.length < config.minFetchPages && searchResults.length > 0) {
								const availableUrls = searchResults.map(r => r.url);
								const additionalUrls = availableUrls.filter(url => !selectedUrls.includes(url));

								while (selectedUrls.length < config.minFetchPages && additionalUrls.length > 0) {
									const nextUrl = additionalUrls.shift();
									if (nextUrl) {
										selectedUrls.push(nextUrl);
										enforcedMinimum = true;
									}
								}
							}

							onProgress({
								type: 'fetching',
								message: `Fetching ${selectedUrls.length} pages${enforcedMinimum ? ' (minimum enforced)' : ''}`,
								detail: selectReasoning
							});

							// Fetch each selected page
							const tokensPerPage = Math.floor(config.tokenBudget / Math.max(selectedUrls.length, 1));

							for (const url of selectedUrls.slice(0, config.fetchLimit)) {
								try {
									onProgress({
										type: 'fetching',
										message: `Fetching: ${new URL(url).hostname}`,
										detail: url
									});

									const page = await fetchPage(url, tokensPerPage);
									fetchedPages.push({
										url: page.url,
										title: page.title,
										content: page.content,
										fetchedAt: new Date().toISOString()
									});
									totalContentTokens += page.tokensUsed;
								} catch (error) {
									// Skip failed pages silently
									console.warn(`Failed to fetch ${url}:`, error);
								}
							}

							const responsePayload: Record<string, unknown> = {
								fetchedCount: fetchedPages.length,
								pages: fetchedPages.map(p => ({
									url: p.url,
									title: p.title,
									contentPreview: p.content.substring(0, 500) + '...'
								}))
							};

							if (enforcedMinimum) {
								responsePayload.note = `Enforced minimum ${config.minFetchPages} pages (agent selected ${(args.selectedUrls as string[]).length})`;
							}

							toolResult = JSON.stringify(responsePayload);
							break;
						}

						case 'finalize_web_context': {
							const webContext = args.webContext as string;
							const sources = args.sources as WebSource[];

							onProgress({
								type: 'complete',
								message: `Research complete`,
								detail: `${sources.length} sources, ${(totalApiTokens + totalContentTokens).toLocaleString()} tokens (${totalApiTokens.toLocaleString()} API + ${totalContentTokens.toLocaleString()} content)`
							});

							return {
								searchPerformed: true,
								webContext,
								sources,
								tokensUsed: totalApiTokens + totalContentTokens,
								contentTokens: totalContentTokens,
								searchQuery,
								searchQueries,
								evaluationReasoning
							};
						}

						default:
							toolResult = JSON.stringify({ error: `Unknown tool: ${name}` });
					}

					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						content: toolResult
					});
				}
			} else {
				// No tool calls - agent might be done or stuck
				finished = true;
			}
		} catch (error) {
			return {
				searchPerformed: searchResults.length > 0,
				webContext: '',
				sources: [],
				tokensUsed: totalApiTokens + totalContentTokens,
				contentTokens: totalContentTokens,
				searchQuery,
				searchQueries,
				evaluationReasoning,
				error: {
					message: 'Web Agent error',
					detail: (error as Error).message
				}
			};
		}
	}

	// If we exit the loop without finalizing, compile what we have
	if (fetchedPages.length > 0) {
		const compiledContext = fetchedPages.map(p =>
			`### ${p.title}\nSource: ${p.url}\n\n${p.content}`
		).join('\n\n---\n\n');

		const sources: WebSource[] = fetchedPages.map(p => ({
			url: p.url,
			title: p.title,
			summary: 'Content fetched'
		}));

		return {
			searchPerformed: true,
			webContext: compiledContext,
			sources,
			tokensUsed: totalApiTokens + totalContentTokens,
			contentTokens: totalContentTokens,
			searchQuery,
			searchQueries,
			evaluationReasoning
		};
	}

	return {
		searchPerformed: false,
		webContext: '',
		sources: [],
		tokensUsed: totalApiTokens,
		skipReason: 'Web Agent completed without gathering web context',
		searchQueries,
		evaluationReasoning
	};
}

// formatWebContextForPrompt is now in src/ai/prompts/webPrompts.ts
// Re-export for backwards compatibility
export { formatWebContextForPrompt } from './prompts';
