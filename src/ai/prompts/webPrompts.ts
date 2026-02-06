/**
 * Web Agent prompts, tool definitions, and formatting helpers
 *
 * Contains:
 * - 4 tool definitions for OpenAI function calling
 * - WEB_AGENT_TOOLS array
 * - buildWebAgentSystemPrompt()
 * - buildWebInitialPrompt()
 * - formatWebContextForPrompt()
 */

import { WebAgentResult } from '../../types';

// Web Agent config interface (needed for prompt building)
export interface WebAgentPromptConfig {
	snippetLimit: number;
	fetchLimit: number;
	tokenBudget: number;
	minFetchPages: number;
	maxQueryRetries: number;
	autoSearch: boolean;
}

// Tool definitions for the Web Agent
export const TOOL_EVALUATE_CONTEXT = {
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

export const TOOL_WEB_SEARCH = {
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

export const TOOL_SELECT_PAGES = {
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

export const TOOL_FINALIZE = {
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

export const WEB_AGENT_TOOLS = [
	TOOL_EVALUATE_CONTEXT,
	TOOL_WEB_SEARCH,
	TOOL_SELECT_PAGES,
	TOOL_FINALIZE
];

/**
 * Build system prompt for the Web Agent
 */
export function buildWebAgentSystemPrompt(config: WebAgentPromptConfig, autoSearchMode: boolean): string {
	const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
	const currentYear = new Date().getFullYear();

	let prompt = `You are a Web Research Agent. Your job is to ${autoSearchMode ? 'search the web and gather relevant information' : 'determine if external web search is needed and gather relevant information'}.

TODAY'S DATE: ${currentDate}
When the user asks about "current", "latest", or "recent" information, use ${currentYear} as the reference year.`;

	if (autoSearchMode) {
		prompt += `

## AUTO-SEARCH MODE ENABLED
Skip evaluation - proceed directly to web_search(). Do NOT call evaluate_context().

## YOUR WORKFLOW

1. Call web_search() with a specific query.
   - Be specific: "React 19 new features ${currentYear}" not "React"
   - Include version numbers, dates, or specific terms when relevant

2. After getting results, call select_pages() to choose which to fetch in full.
   - Prefer authoritative sources; for niche topics, forums and blogs are acceptable
   - See LIMITS section for min/max pages and token budget

3. Finally, call finalize_web_context() with compiled findings.
   - Be concise but include all relevant information
   - Always cite sources`;
	} else {
		prompt += `

## YOUR WORKFLOW

1. FIRST, call evaluate_context() to assess if the vault context can fully answer the user's task.
   - Consider: Does the task ask about current/latest information? External technologies? Current best practices?
   - If user says "search the web" or "look up" → always search
   - If the task is purely about the user's personal notes → vault is sufficient

2. IF search is needed, call web_search() with a specific query.
   - Be specific: "React 19 new features ${currentYear}" not "React"
   - Include version numbers, dates, or specific terms when relevant

3. After getting results, call select_pages() to choose which to fetch in full.
   - Prefer authoritative sources; for niche topics, forums and blogs are acceptable
   - See LIMITS section for min/max pages and token budget

4. Finally, call finalize_web_context() with compiled findings.
   - Be concise but include all relevant information
   - Always cite sources`;
	}

	prompt += `

## LIMITS
- Max search results: ${config.snippetLimit}
- Min pages to fetch: ${config.minFetchPages}
- Max pages to fetch: ${config.fetchLimit}
- Token budget: ${config.tokenBudget}

## QUERY REFORMULATION
If a search yields fewer than 3 results, you may try a different query formulation.
- Use synonyms, broader terms, or different phrasings
- You have up to ${config.maxQueryRetries} reformulation attempt${config.maxQueryRetries !== 1 ? 's' : ''}

## IMPORTANT
${autoSearchMode ? '' : '- If vault context is sufficient, call evaluate_context with sufficient=true and you\'re done\n'}- Don't fabricate information - only use what you find
- If search fails, call finalize_web_context() explaining the failure in webContext with an empty sources array`;

	return prompt;
}

/**
 * Build the initial user message for the Web Agent
 */
export function buildWebInitialPrompt(task: string, vaultContext: string, autoSearchMode: boolean): string {
	if (autoSearchMode) {
		return `## USER TASK
${task}

## VAULT CONTEXT (Notes from user's vault)
${vaultContext.substring(0, 8000)}${vaultContext.length > 8000 ? '\n[... vault context truncated ...]' : ''}

Auto-search enabled. Proceed directly to web_search() with an appropriate query for this task.`;
	} else {
		return `## USER TASK
${task}

## VAULT CONTEXT (Notes from user's vault)
${vaultContext.substring(0, 8000)}${vaultContext.length > 8000 ? '\n[... vault context truncated ...]' : ''}

Evaluate whether this vault context is sufficient to fully answer the task, or if web search is needed.`;
	}
}

/**
 * Format web context for inclusion in the Task Agent prompt
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
