/**
 * Web tool definitions for the unified Agent
 *
 * 2 tools: web_search, read_webpage
 */

import { AgentCallbacks } from '../../types';
import { OpenAITool } from './vaultTools';

export const TOOL_WEB_SEARCH: OpenAITool = {
	type: 'function',
	function: {
		name: 'web_search',
		description: 'Search the web. Returns titles, URLs, and snippets. For detailed info, follow up with read_webpage on promising results.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search query'
				}
			},
			required: ['query']
		}
	}
};

export const TOOL_READ_WEBPAGE: OpenAITool = {
	type: 'function',
	function: {
		name: 'read_webpage',
		description: 'Fetch and read a webpage. Use after web_search to get full content from a promising result.',
		parameters: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description: 'URL to fetch'
				},
				max_tokens: {
					type: 'number',
					description: 'Max tokens of content to return (default 4000)'
				}
			},
			required: ['url']
		}
	}
};

export const ALL_WEB_TOOLS: OpenAITool[] = [
	TOOL_WEB_SEARCH,
	TOOL_READ_WEBPAGE
];

/**
 * Handle a web tool call and return the result string
 */
export async function handleWebToolCall(
	name: string,
	args: Record<string, unknown>,
	callbacks: AgentCallbacks,
	snippetLimit: number
): Promise<string> {
	switch (name) {
		case 'web_search': {
			if (!callbacks.webSearch) {
				return 'Web search is not configured. Please set up a search API in settings.';
			}
			const query = args.query as string;
			const results = await callbacks.webSearch(query, snippetLimit);
			if (results.length === 0) return `No results found for: "${query}"`;
			return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
		}

		case 'read_webpage': {
			if (!callbacks.fetchPage) {
				return 'Web page fetching is not available.';
			}
			const url = args.url as string;
			const maxTokens = (args.max_tokens as number) || 4000;
			try {
				const page = await callbacks.fetchPage(url, maxTokens);
				return `=== ${page.title} ===\n${page.content}`;
			} catch (e) {
				return `Failed to fetch page: ${(e as Error).message}`;
			}
		}

		default:
			return `Unknown web tool: ${name}`;
	}
}
