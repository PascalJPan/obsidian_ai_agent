/**
 * Search API Wrapper for Web Agent
 *
 * Provides unified interface for web search APIs (Serper, Brave, Tavily)
 * and page content fetching with token budget management.
 */

import { requestUrl } from 'obsidian';
import { SearchApiType } from '../types';

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

export interface FetchedPage {
	url: string;
	title: string;
	content: string;
	tokensUsed: number;
}

/**
 * Search the web using the specified API
 */
export async function webSearch(
	query: string,
	api: SearchApiType,
	apiKey: string,
	limit: number
): Promise<SearchResult[]> {
	if (!apiKey) {
		throw new Error(`No API key provided for ${api} search`);
	}

	switch (api) {
		case 'openai':
			return searchWithOpenAI(query, apiKey, limit);
		case 'serper':
			return searchWithSerper(query, apiKey, limit);
		case 'brave':
			return searchWithBrave(query, apiKey, limit);
		case 'tavily':
			return searchWithTavily(query, apiKey, limit);
		default:
			throw new Error(`Unknown search API: ${api}`);
	}
}

/**
 * Search using OpenAI Responses API with web_search_preview tool
 * Uses the main OpenAI API key - no separate search API key needed
 * https://platform.openai.com/docs/guides/tools-web-search
 */
async function searchWithOpenAI(query: string, apiKey: string, limit: number): Promise<SearchResult[]> {
	const response = await requestUrl({
		url: 'https://api.openai.com/v1/responses',
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: 'gpt-4o-mini',
			tools: [{
				type: 'web_search_preview',
				search_context_size: limit <= 5 ? 'low' : limit <= 10 ? 'medium' : 'high'
			}],
			input: `Search the web for: ${query}`,
			tool_choice: { type: 'web_search_preview' }
		}),
	});

	const data = response.json;
	const results: SearchResult[] = [];

	// Parse response output for search results
	// The response contains output items with type 'web_search_call' that have results
	if (data.output && Array.isArray(data.output)) {
		for (const item of data.output) {
			// Look for web_search_call items which contain the search results
			if (item.type === 'web_search_call' && item.status === 'completed') {
				// Results are in the search_results field
				continue; // The actual results are in a message item
			}
			// Look for message items that may contain URL annotations
			if (item.type === 'message' && item.content) {
				for (const content of item.content) {
					if (content.type === 'output_text' && content.annotations) {
						// Extract URL citations from annotations
						for (const annotation of content.annotations) {
							if (annotation.type === 'url_citation' && results.length < limit) {
								results.push({
									title: annotation.title || 'Untitled',
									url: annotation.url || '',
									snippet: annotation.snippet || '',
								});
							}
						}
					}
				}
			}
		}
	}

	return results;
}

/**
 * Search using Serper.dev API
 * https://serper.dev/
 */
async function searchWithSerper(query: string, apiKey: string, limit: number): Promise<SearchResult[]> {
	const response = await requestUrl({
		url: 'https://google.serper.dev/search',
		method: 'POST',
		headers: {
			'X-API-KEY': apiKey,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			q: query,
			num: limit,
		}),
	});

	const data = response.json;
	const results: SearchResult[] = [];

	// Serper returns organic results
	if (data.organic && Array.isArray(data.organic)) {
		for (const item of data.organic.slice(0, limit)) {
			results.push({
				title: item.title || '',
				url: item.link || '',
				snippet: item.snippet || '',
			});
		}
	}

	return results;
}

/**
 * Search using Brave Search API
 * https://brave.com/search/api/
 */
async function searchWithBrave(query: string, apiKey: string, limit: number): Promise<SearchResult[]> {
	const params = new URLSearchParams({
		q: query,
		count: limit.toString(),
	});

	const response = await requestUrl({
		url: `https://api.search.brave.com/res/v1/web/search?${params}`,
		method: 'GET',
		headers: {
			'Accept': 'application/json',
			'X-Subscription-Token': apiKey,
		},
	});

	const data = response.json;
	const results: SearchResult[] = [];

	// Brave returns web results
	if (data.web && data.web.results && Array.isArray(data.web.results)) {
		for (const item of data.web.results.slice(0, limit)) {
			results.push({
				title: item.title || '',
				url: item.url || '',
				snippet: item.description || '',
			});
		}
	}

	return results;
}

/**
 * Search using Tavily API
 * https://tavily.com/
 */
async function searchWithTavily(query: string, apiKey: string, limit: number): Promise<SearchResult[]> {
	const response = await requestUrl({
		url: 'https://api.tavily.com/search',
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			api_key: apiKey,
			query: query,
			max_results: limit,
			include_answer: false,
			search_depth: 'basic',
		}),
	});

	const data = response.json;
	const results: SearchResult[] = [];

	// Tavily returns results array
	if (data.results && Array.isArray(data.results)) {
		for (const item of data.results.slice(0, limit)) {
			results.push({
				title: item.title || '',
				url: item.url || '',
				snippet: item.content || '',
			});
		}
	}

	return results;
}

/**
 * Fetch a web page and extract readable content
 *
 * Uses a simple approach: fetch HTML, strip tags, and truncate to token budget.
 * For production, consider using a readability library.
 */
export async function fetchPage(
	url: string,
	maxTokens: number
): Promise<FetchedPage> {
	try {
		const response = await requestUrl({
			url: url,
			method: 'GET',
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; ObsidianAgent/1.0)',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			},
		});

		const html = response.text;

		// Extract title
		const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
		const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : 'Untitled';

		// Extract readable content
		const content = extractReadableContent(html);

		// Truncate to token budget (rough estimate: 4 chars per token)
		const maxChars = maxTokens * 4;
		const truncatedContent = content.length > maxChars
			? content.substring(0, maxChars) + '\n\n[... content truncated ...]'
			: content;

		const tokensUsed = Math.ceil(truncatedContent.length / 4);

		return {
			url,
			title,
			content: truncatedContent,
			tokensUsed,
		};
	} catch (error) {
		throw new Error(`Failed to fetch ${url}: ${(error as Error).message}`);
	}
}

/**
 * Extract readable text content from HTML
 */
function extractReadableContent(html: string): string {
	// Remove script and style tags with their content
	let content = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
	content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

	// Remove HTML comments
	content = content.replace(/<!--[\s\S]*?-->/g, '');

	// Remove navigation, header, footer, aside tags (common non-content areas)
	content = content.replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

	// Try to extract main content area if it exists
	const mainMatch = content.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i);
	if (mainMatch) {
		content = mainMatch[2];
	}

	// Remove all remaining HTML tags
	content = content.replace(/<[^>]+>/g, ' ');

	// Decode HTML entities
	content = decodeHtmlEntities(content);

	// Normalize whitespace
	content = content.replace(/\s+/g, ' ').trim();

	// Add paragraph breaks at sentence boundaries for readability
	content = content.replace(/\. (?=[A-Z])/g, '.\n\n');

	return content;
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text: string): string {
	const entities: Record<string, string> = {
		'&amp;': '&',
		'&lt;': '<',
		'&gt;': '>',
		'&quot;': '"',
		'&#39;': "'",
		'&apos;': "'",
		'&nbsp;': ' ',
		'&mdash;': '—',
		'&ndash;': '–',
		'&hellip;': '…',
		'&copy;': '©',
		'&reg;': '®',
		'&trade;': '™',
	};

	let result = text;
	for (const [entity, char] of Object.entries(entities)) {
		result = result.replace(new RegExp(entity, 'gi'), char);
	}

	// Handle numeric entities
	result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
	result = result.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

	return result;
}

/**
 * Estimate tokens for a string (rough: 4 chars per token)
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}
