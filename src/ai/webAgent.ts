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
import { webSearch, fetchPage, SearchResult, estimateTokens, SearchApiType } from './searchApi';

export interface WebAgentConfig {
	searchApi: SearchApiType;
	searchApiKey: string;
	snippetLimit: number;     // Max search results to retrieve
	fetchLimit: number;       // Max pages to fetch in full
	tokenBudget: number;      // Max tokens for web content
	model: string;            // LLM model for agent reasoning
	openaiApiKey: string;     // OpenAI API key for LLM calls
	autoSearch: boolean;      // Whether to automatically search when needed
}

export interface WebSource {
	url: string;
	title: string;
	summary: string;
}

export interface WebAgentResult {
	searchPerformed: boolean;
	webContext: string;           // Formatted for Answer agent
	sources: WebSource[];
	tokensUsed: number;
	searchQuery?: string;
	skipReason?: string;          // If search was skipped
	error?: {                     // If search failed
		message: string;
		detail: string;
	};
}

export interface WebAgentProgressEvent {
	type: 'evaluating' | 'searching' | 'fetching' | 'extracting' | 'complete' | 'skipped' | 'error';
	message: string;
	detail?: string;
}

// Tool definitions for the Web Agent
const TOOL_EVALUATE_CONTEXT = {
	type: 'function' as const,
	function: {
		name: 'evaluate_context',
		description: 'Evaluate whether the vault context is sufficient to answer the task, or if web search is needed. Consider: Does the task ask about current/latest information? External technologies? Best practices that may have changed? User explicitly requesting web search?',
		parameters: {
			type: 'object',
			properties: {
				sufficient: {
					type: 'boolean',
					description: 'true if vault context is sufficient, false if web search is needed'
				},
				reasoning: {
					type: 'string',
					description: 'Explain why vault context is or is not sufficient'
				},
				searchTopics: {
					type: 'array',
					items: { type: 'string' },
					description: 'If not sufficient: topics to search for (max 3)'
				}
			},
			required: ['sufficient', 'reasoning']
		}
	}
};

const TOOL_WEB_SEARCH = {
	type: 'function' as const,
	function: {
		name: 'web_search',
		description: 'Search the web for information. Use specific, targeted queries.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search query - be specific and include relevant keywords'
				}
			},
			required: ['query']
		}
	}
};

const TOOL_SELECT_PAGES = {
	type: 'function' as const,
	function: {
		name: 'select_pages',
		description: 'Select which search results to fetch in full. Choose the most relevant and authoritative sources.',
		parameters: {
			type: 'object',
			properties: {
				selectedUrls: {
					type: 'array',
					items: { type: 'string' },
					description: 'URLs to fetch (max fetchLimit pages)'
				},
				reasoning: {
					type: 'string',
					description: 'Why these pages were selected'
				}
			},
			required: ['selectedUrls', 'reasoning']
		}
	}
};

const TOOL_FINALIZE = {
	type: 'function' as const,
	function: {
		name: 'finalize_web_context',
		description: 'Complete web research and compile the gathered information.',
		parameters: {
			type: 'object',
			properties: {
				webContext: {
					type: 'string',
					description: 'Compiled web research findings relevant to the task. Be concise but comprehensive.'
				},
				sources: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							url: { type: 'string' },
							title: { type: 'string' },
							summary: { type: 'string', description: 'One-sentence summary of what this source contributed' }
						},
						required: ['url', 'title', 'summary']
					},
					description: 'List of sources used'
				}
			},
			required: ['webContext', 'sources']
		}
	}
};

const WEB_AGENT_TOOLS = [
	TOOL_EVALUATE_CONTEXT,
	TOOL_WEB_SEARCH,
	TOOL_SELECT_PAGES,
	TOOL_FINALIZE
];

/**
 * Build system prompt for the Web Agent
 */
function buildWebAgentSystemPrompt(config: WebAgentConfig): string {
	const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
	const currentYear = new Date().getFullYear();

	return `You are a Web Research Agent. Your job is to determine if external web search is needed and gather relevant information.

TODAY'S DATE: ${currentDate}
When the user asks about "current", "latest", or "recent" information, use ${currentYear} as the reference year.

## YOUR WORKFLOW

1. FIRST, call evaluate_context() to assess if the vault context can fully answer the user's task.
   - Consider: Does the task ask about current/latest information? External technologies? Current best practices?
   - If user says "search the web" or "look up" → always search
   - If the task is purely about the user's personal notes → vault is sufficient

2. IF search is needed, call web_search() with a specific query.
   - Be specific: "React 19 new features ${currentYear}" not "React"
   - Include version numbers, dates, or specific terms when relevant

3. After getting results, call select_pages() to choose which to fetch in full.
   - Prefer official documentation, reputable tech sites
   - Max ${config.fetchLimit} pages (you have ${config.tokenBudget} tokens budget)

4. Finally, call finalize_web_context() with compiled findings.
   - Be concise but include all relevant information
   - Always cite sources

## LIMITS
- Max search results: ${config.snippetLimit}
- Max pages to fetch: ${config.fetchLimit}
- Token budget: ${config.tokenBudget}

## IMPORTANT
- If vault context is sufficient, call evaluate_context with sufficient=true and you're done
- Don't fabricate information - only use what you find
- If search fails, report the error and continue without web context`;
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

	const systemPrompt = buildWebAgentSystemPrompt(config);

	const initialPrompt = `## USER TASK
${task}

## VAULT CONTEXT (Notes from user's vault)
${vaultContext.substring(0, 4000)}${vaultContext.length > 4000 ? '\n[... vault context truncated ...]' : ''}

Evaluate whether this vault context is sufficient to fully answer the task, or if web search is needed.`;

	const messages: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }> = [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: initialPrompt }
	];

	// State tracking
	let searchResults: SearchResult[] = [];
	let fetchedPages: Array<{ url: string; title: string; content: string }> = [];
	let totalTokensUsed = 0;
	let searchQuery: string | undefined;
	let finished = false;
	let maxIterations = 5; // Safety limit
	let iteration = 0;

	onProgress({ type: 'evaluating', message: 'Evaluating vault context...' });

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
					tools: WEB_AGENT_TOOLS,
					tool_choice: 'auto'
				}),
			});

			const data = response.json;
			const assistantMessage = data.choices?.[0]?.message;

			if (!assistantMessage) {
				return {
					searchPerformed: false,
					webContext: '',
					sources: [],
					tokensUsed: totalTokensUsed,
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
									tokensUsed: totalTokensUsed,
									skipReason: reasoning
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

								toolResult = JSON.stringify({
									results: searchResults.map(r => ({
										title: r.title,
										url: r.url,
										snippet: r.snippet
									}))
								});
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
							const selectedUrls = args.selectedUrls as string[];
							const selectReasoning = args.reasoning as string;

							onProgress({
								type: 'fetching',
								message: `Fetching ${selectedUrls.length} pages`,
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
										content: page.content
									});
									totalTokensUsed += page.tokensUsed;
								} catch (error) {
									// Skip failed pages silently
									console.warn(`Failed to fetch ${url}:`, error);
								}
							}

							toolResult = JSON.stringify({
								fetchedCount: fetchedPages.length,
								pages: fetchedPages.map(p => ({
									url: p.url,
									title: p.title,
									contentPreview: p.content.substring(0, 500) + '...'
								}))
							});
							break;
						}

						case 'finalize_web_context': {
							const webContext = args.webContext as string;
							const sources = args.sources as WebSource[];

							onProgress({
								type: 'complete',
								message: `Research complete`,
								detail: `${sources.length} sources, ${totalTokensUsed} tokens`
							});

							return {
								searchPerformed: true,
								webContext,
								sources,
								tokensUsed: totalTokensUsed,
								searchQuery
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
				tokensUsed: totalTokensUsed,
				searchQuery,
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
			tokensUsed: totalTokensUsed,
			searchQuery
		};
	}

	return {
		searchPerformed: false,
		webContext: '',
		sources: [],
		tokensUsed: 0,
		skipReason: 'Web Agent completed without gathering web context'
	};
}

/**
 * Format web context for inclusion in the Answer/Edit prompt
 */
export function formatWebContextForPrompt(result: WebAgentResult): string {
	if (!result.searchPerformed || !result.webContext) {
		return '';
	}

	let formatted = '=== WEB RESEARCH RESULTS ===\n\n';
	formatted += result.webContext;
	formatted += '\n\n=== SOURCES ===\n';

	for (const source of result.sources) {
		formatted += `- [${source.title}](${source.url}): ${source.summary}\n`;
	}

	formatted += '\n=== END WEB RESEARCH ===\n';

	return formatted;
}
