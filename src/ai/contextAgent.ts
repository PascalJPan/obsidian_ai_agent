/**
 * Context Agent for Agentic Mode
 *
 * Phase 1 of agentic workflow: An AI agent that explores the vault
 * dynamically using tools to find relevant notes for the user's task.
 */

import { requestUrl, TFile, Vault, MetadataCache } from 'obsidian';
import {
	AgenticModeConfig,
	ContextAgentResult,
	AgentProgressEvent,
	NotePreview,
	SemanticSearchResult,
	LinkInfo,
	EmbeddingIndex,
	EmbeddingModel
} from '../types';
import { generateEmbedding, searchSemantic } from './semantic';

// Agent's running selection (updated throughout exploration)
interface SelectionState {
	selectedPaths: string[];
	reasoning: string;
	confidence: 'exploring' | 'confident' | 'done';
}

// Tool definitions for OpenAI function calling
const CONTEXT_AGENT_TOOLS = [
	{
		type: 'function' as const,
		function: {
			name: 'update_selection',
			description: 'Update your current selection of relevant notes. CRITICAL: Call this after each exploration step to save your progress. Set confidence to "done" when you have enough context.',
			parameters: {
				type: 'object',
				properties: {
					selectedPaths: {
						type: 'array',
						items: { type: 'string' },
						description: 'Current best picks - full paths (e.g., "Projects/My Project.md")'
					},
					reasoning: {
						type: 'string',
						description: 'Why these notes are relevant to the task'
					},
					confidence: {
						type: 'string',
						enum: ['exploring', 'confident', 'done'],
						description: '"exploring" = still looking, "confident" = good selection but may continue, "done" = finished exploring'
					}
				},
				required: ['selectedPaths', 'reasoning', 'confidence']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'list_notes',
			description: 'List notes with brief previews. Use to get an overview of available notes.',
			parameters: {
				type: 'object',
				properties: {
					folder: {
						type: 'string',
						description: 'Optional folder path to filter by (e.g., "Projects/Active")'
					},
					limit: {
						type: 'number',
						description: 'Max notes to return (default 30, max 50)'
					}
				}
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'search_keyword',
			description: 'Search for notes containing a keyword. Results prioritized: title matches > heading matches > content matches. Fast and deterministic.',
			parameters: {
				type: 'object',
				properties: {
					keyword: {
						type: 'string',
						description: 'The word or phrase to search for'
					},
					limit: {
						type: 'number',
						description: 'Max results (default from settings, typically 10)'
					}
				},
				required: ['keyword']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'search_semantic',
			description: 'Search for notes semantically similar to a query. Best for finding conceptually related notes when you don\'t know exact keywords.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Search query - describe what you\'re looking for'
					},
					topK: {
						type: 'number',
						description: 'Number of results (default 10, max 20)'
					}
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'search_task_relevant',
			description: 'Search for notes relevant to accomplishing a specific task. Combines task context with semantic search for better results.',
			parameters: {
				type: 'object',
				properties: {
					task: {
						type: 'string',
						description: 'The task description - what you need to accomplish'
					},
					topK: {
						type: 'number',
						description: 'Number of results (default 10)'
					}
				},
				required: ['task']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'fetch_note',
			description: 'Get the full content of a specific note to verify its relevance.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Path to the note (e.g., "Projects/My Project.md")'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'get_links',
			description: 'Get notes directly linked to/from a specific note. For single-hop exploration.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Path to the note'
					},
					direction: {
						type: 'string',
						enum: ['in', 'out', 'both'],
						description: 'Link direction: "in" (backlinks), "out" (outgoing), or "both"'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'get_links_recursive',
			description: 'Get all notes within N hops of a note. Efficient multi-hop exploration in one call.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Path to the starting note'
					},
					depth: {
						type: 'number',
						description: 'How many hops to follow (1-3)'
					},
					direction: {
						type: 'string',
						enum: ['in', 'out', 'both'],
						description: 'Link direction: "in" (backlinks), "out" (outgoing), or "both"'
					}
				},
				required: ['path']
			}
		}
	}
];

function buildContextAgentSystemPrompt(maxNotes: number): string {
	return `You are a context curator for an AI assistant. Your goal: find notes that will help accomplish the user's task.

## WORKFLOW
1. Analyze the task - what kind of information would help?
2. Explore using tools (you can call up to 2 tools per turn for efficiency)
3. After EACH exploration step, call update_selection() with your current best picks
4. When confident you have enough context, set confidence: "done"

## AVAILABLE SEARCH STRATEGIES
- search_keyword("term") - Fast exact search, prioritizes title > heading > content matches
- search_semantic("concept") - Find conceptually related notes via embeddings
- search_task_relevant("do X with Y") - Task-focused semantic search
- get_links_recursive(path, depth=2) - Get all notes within N hops of a note

## EXPLORATION TIPS
- Start with keyword search for specific terms, semantic for concepts
- For promising results, check THEIR links (multi-hop exploration)
- You can call tools on ANY note path, not just the current one
- Call multiple tools in parallel to explore efficiently

## MULTI-HOP EXAMPLE
1. search_keyword("project") → finds "Projects.md" (title match)
2. get_links_recursive("Projects.md", depth=2) → discovers "Roadmap.md", "Tasks.md"
3. These linked notes may be more relevant than direct search results!

## CRITICAL RULES
- Call update_selection() after EACH exploration step with your reasoning
- This ensures we always have your best picks even if exploration is interrupted
- Select up to ${maxNotes} notes maximum. Quality over quantity.
- Include the current note path if it's relevant
- When done, set confidence: "done" to finish exploration`;
}

interface ToolHandlerContext {
	vault: Vault;
	metadataCache: MetadataCache;
	excludedFolders: string[];
	embeddingIndex: EmbeddingIndex | null;
	apiKey: string;
	embeddingModel: EmbeddingModel;
	fetchedNotes: Set<string>;  // Track notes we've already fetched
	currentFilePath: string;    // Path of the current file for task-relevant search
	currentFileContent: string; // Content of current file for task-relevant search
	keywordLimit: number;       // Default limit for keyword search results
}

/**
 * Handle tool calls from the context agent
 */
async function handleToolCall(
	name: string,
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	switch (name) {
		case 'update_selection':
			// update_selection is handled specially in the main loop
			return JSON.stringify({ status: 'selection_updated' });
		case 'list_notes':
			return await handleListNotes(args, context, onProgress);
		case 'search_keyword':
			return await handleSearchKeyword(args, context, onProgress);
		case 'search_semantic':
			return await handleSearchSemantic(args, context, onProgress);
		case 'search_task_relevant':
			return await handleSearchTaskRelevant(args, context, onProgress);
		case 'fetch_note':
			return await handleFetchNote(args, context, onProgress);
		case 'get_links':
			return await handleGetLinks(args, context, onProgress);
		case 'get_links_recursive':
			return await handleGetLinksRecursive(args, context, onProgress);
		default:
			return JSON.stringify({ error: `Unknown tool: ${name}` });
	}
}

async function handleListNotes(
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	const folder = args.folder as string | undefined;
	const limit = Math.min((args.limit as number) || 30, 50);

	onProgress({
		type: 'tool_call',
		message: folder ? `Listing notes in ${folder}` : 'Listing all notes',
		detail: `limit: ${limit}`
	});

	const allFiles = context.vault.getMarkdownFiles();
	let filtered = allFiles.filter(f => !isFileExcluded(f.path, context.excludedFolders));

	if (folder) {
		const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
		filtered = filtered.filter(f =>
			f.path.startsWith(normalizedFolder) || f.parent?.path === folder
		);
	}

	// Sort by modification time (most recent first)
	filtered.sort((a, b) => b.stat.mtime - a.stat.mtime);
	filtered = filtered.slice(0, limit);

	const previews: NotePreview[] = await Promise.all(
		filtered.map(async f => {
			const content = await context.vault.cachedRead(f);
			return {
				path: f.path,
				name: f.basename,
				preview: content.substring(0, 200).replace(/\n/g, ' ').trim() + (content.length > 200 ? '...' : '')
			};
		})
	);

	return JSON.stringify({ notes: previews, total: filtered.length });
}

async function handleSearchSemantic(
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	const query = args.query as string;
	const topK = Math.min((args.topK as number) || 10, 20);

	onProgress({
		type: 'tool_call',
		message: `Semantic search: "${query.substring(0, 40)}${query.length > 40 ? '...' : ''}"`,
		detail: `topK: ${topK}`
	});

	if (!context.embeddingIndex) {
		return JSON.stringify({
			error: 'No embedding index available. Please reindex in settings.',
			results: []
		});
	}

	try {
		const queryEmbedding = await generateEmbedding(
			query,
			context.apiKey,
			context.embeddingModel
		);

		const excludePaths = new Set<string>();
		const matches = searchSemantic(
			queryEmbedding,
			context.embeddingIndex,
			excludePaths,
			topK,
			0.3  // Minimum similarity threshold
		);

		const results: SemanticSearchResult[] = matches.map(m => ({
			path: m.notePath,
			score: Math.round(m.score * 100) / 100,
			heading: m.heading
		}));

		onProgress({
			type: 'tool_call',
			message: `Found ${results.length} semantic matches`,
			detail: results.slice(0, 3).map(r => r.path.split('/').pop()).join(', ')
		});

		return JSON.stringify({ results });
	} catch (error) {
		return JSON.stringify({
			error: `Semantic search failed: ${(error as Error).message}`,
			results: []
		});
	}
}

async function handleFetchNote(
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	const path = args.path as string;

	// Try to find the file
	const file = context.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		// Try matching by name
		const allFiles = context.vault.getMarkdownFiles();
		const match = allFiles.find(f =>
			f.path === path ||
			f.path.endsWith('/' + path) ||
			f.name === path ||
			f.basename === path.replace('.md', '')
		);

		if (!match) {
			return JSON.stringify({ error: `Note not found: ${path}` });
		}

		return await fetchNoteContent(match, context, onProgress);
	}

	return await fetchNoteContent(file, context, onProgress);
}

async function fetchNoteContent(
	file: TFile,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	if (isFileExcluded(file.path, context.excludedFolders)) {
		return JSON.stringify({ error: `Note is in excluded folder: ${file.path}` });
	}

	onProgress({
		type: 'tool_call',
		message: `Fetching: ${file.basename}`,
		detail: file.path
	});

	context.fetchedNotes.add(file.path);
	const content = await context.vault.cachedRead(file);

	// Truncate very long notes
	const maxLength = 8000;
	const truncated = content.length > maxLength;

	return JSON.stringify({
		path: file.path,
		name: file.basename,
		content: truncated ? content.substring(0, maxLength) + '\n\n[... truncated]' : content,
		truncated
	});
}

async function handleGetLinks(
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	const path = args.path as string;
	const direction = (args.direction as string) || 'both';

	const file = context.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return JSON.stringify({ error: `Note not found: ${path}` });
	}

	onProgress({
		type: 'tool_call',
		message: `Getting ${direction} links from ${file.basename}`,
		detail: path
	});

	const links: LinkInfo[] = [];

	// Get outgoing links
	if (direction === 'out' || direction === 'both') {
		const cache = context.metadataCache.getFileCache(file);
		for (const link of cache?.links ?? []) {
			const linkedFile = context.metadataCache.getFirstLinkpathDest(link.link, file.path);
			if (linkedFile instanceof TFile && !isFileExcluded(linkedFile.path, context.excludedFolders)) {
				links.push({ path: linkedFile.path, direction: 'outgoing' });
			}
		}
	}

	// Get backlinks
	if (direction === 'in' || direction === 'both') {
		const resolvedLinks = context.metadataCache.resolvedLinks;
		for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
			if (path in targets && !isFileExcluded(sourcePath, context.excludedFolders)) {
				links.push({ path: sourcePath, direction: 'backlink' });
			}
		}
	}

	onProgress({
		type: 'tool_call',
		message: `Found ${links.length} links`,
		detail: links.slice(0, 3).map(l => l.path.split('/').pop()).join(', ')
	});

	return JSON.stringify({ links });
}

/**
 * Search for notes containing a keyword with priority scoring
 */
async function handleSearchKeyword(
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	const keyword = (args.keyword as string || '').toLowerCase().trim();
	const limit = Math.min((args.limit as number) || context.keywordLimit, 20);

	if (!keyword) {
		return JSON.stringify({ error: 'Keyword is required', results: [] });
	}

	onProgress({
		type: 'tool_call',
		message: `Keyword search: "${keyword.substring(0, 30)}${keyword.length > 30 ? '...' : ''}"`,
		detail: `limit: ${limit}`
	});

	const allFiles = context.vault.getMarkdownFiles();
	const results: Array<{ path: string; matchType: 'title' | 'heading' | 'content'; preview: string; priority: number }> = [];

	for (const file of allFiles) {
		if (isFileExcluded(file.path, context.excludedFolders)) continue;

		const fileName = file.basename.toLowerCase();
		let matchType: 'title' | 'heading' | 'content' | null = null;
		let priority = 0;
		let preview = '';

		// Check title match (highest priority)
		if (fileName.includes(keyword)) {
			matchType = 'title';
			priority = 3;
			preview = `Title: ${file.basename}`;
		}

		// If no title match, check content
		if (!matchType) {
			const content = await context.vault.cachedRead(file);
			const lines = content.split('\n');

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const lineLower = line.toLowerCase();

				if (lineLower.includes(keyword)) {
					// Check if it's a heading
					if (line.trim().startsWith('#')) {
						matchType = 'heading';
						priority = 2;
						preview = line.trim();
						break;
					} else if (!matchType) {
						matchType = 'content';
						priority = 1;
						// Get context around the match
						const start = Math.max(0, i - 1);
						const end = Math.min(lines.length, i + 2);
						preview = lines.slice(start, end).join(' ').substring(0, 150) + '...';
					}
				}
			}
		}

		if (matchType) {
			results.push({ path: file.path, matchType, preview, priority });
		}
	}

	// Sort by priority (title > heading > content), then by path
	results.sort((a, b) => {
		if (b.priority !== a.priority) return b.priority - a.priority;
		return a.path.localeCompare(b.path);
	});

	const limitedResults = results.slice(0, limit).map(r => ({
		path: r.path,
		matchType: r.matchType,
		preview: r.preview
	}));

	onProgress({
		type: 'tool_call',
		message: `Found ${limitedResults.length} keyword matches`,
		detail: limitedResults.slice(0, 3).map(r => `${r.matchType}: ${r.path.split('/').pop()}`).join(', ')
	});

	return JSON.stringify({ results: limitedResults });
}

/**
 * Task-aware semantic search combining task with current note context
 */
async function handleSearchTaskRelevant(
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	const task = args.task as string;
	const topK = Math.min((args.topK as number) || 10, 20);

	if (!task) {
		return JSON.stringify({ error: 'Task description is required', results: [] });
	}

	onProgress({
		type: 'tool_call',
		message: `Task-relevant search: "${task.substring(0, 30)}${task.length > 30 ? '...' : ''}"`,
		detail: `topK: ${topK}`
	});

	if (!context.embeddingIndex) {
		return JSON.stringify({
			error: 'No embedding index available. Please reindex in settings.',
			results: []
		});
	}

	try {
		// Combine task with a summary of current note for better context
		const currentNoteSummary = context.currentFileContent.substring(0, 500);
		const enhancedQuery = `Task: ${task}\n\nContext from current note: ${currentNoteSummary}`;

		const queryEmbedding = await generateEmbedding(
			enhancedQuery,
			context.apiKey,
			context.embeddingModel
		);

		// Exclude current file from results
		const excludePaths = new Set<string>([context.currentFilePath]);
		const matches = searchSemantic(
			queryEmbedding,
			context.embeddingIndex,
			excludePaths,
			topK,
			0.3
		);

		const results: SemanticSearchResult[] = matches.map(m => ({
			path: m.notePath,
			score: Math.round(m.score * 100) / 100,
			heading: m.heading
		}));

		onProgress({
			type: 'tool_call',
			message: `Found ${results.length} task-relevant matches`,
			detail: results.slice(0, 3).map(r => r.path.split('/').pop()).join(', ')
		});

		return JSON.stringify({ results });
	} catch (error) {
		return JSON.stringify({
			error: `Task-relevant search failed: ${(error as Error).message}`,
			results: []
		});
	}
}

/**
 * Get all notes within N hops of a note (BFS traversal)
 */
async function handleGetLinksRecursive(
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	const path = args.path as string;
	const depth = Math.min(Math.max((args.depth as number) || 2, 1), 3);
	const direction = (args.direction as string) || 'both';

	const file = context.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return JSON.stringify({ error: `Note not found: ${path}` });
	}

	onProgress({
		type: 'tool_call',
		message: `Getting ${direction} links (depth ${depth}) from ${file.basename}`,
		detail: path
	});

	// BFS traversal
	const visited = new Set<string>([path]);
	const results: Array<{ path: string; depth: number; direction: 'outgoing' | 'backlink' }> = [];
	let currentLevel: Array<{ path: string; depth: number }> = [{ path, depth: 0 }];

	while (currentLevel.length > 0 && currentLevel[0].depth < depth) {
		const nextLevel: Array<{ path: string; depth: number }> = [];
		const currentDepth = currentLevel[0].depth + 1;

		for (const { path: currentPath } of currentLevel) {
			const currentFile = context.vault.getAbstractFileByPath(currentPath);
			if (!(currentFile instanceof TFile)) continue;

			// Get outgoing links
			if (direction === 'out' || direction === 'both') {
				const cache = context.metadataCache.getFileCache(currentFile);
				for (const link of cache?.links ?? []) {
					const linkedFile = context.metadataCache.getFirstLinkpathDest(link.link, currentPath);
					if (linkedFile instanceof TFile &&
						!visited.has(linkedFile.path) &&
						!isFileExcluded(linkedFile.path, context.excludedFolders)) {
						visited.add(linkedFile.path);
						results.push({ path: linkedFile.path, depth: currentDepth, direction: 'outgoing' });
						nextLevel.push({ path: linkedFile.path, depth: currentDepth });
					}
				}
			}

			// Get backlinks
			if (direction === 'in' || direction === 'both') {
				const resolvedLinks = context.metadataCache.resolvedLinks;
				for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
					if (currentPath in targets &&
						!visited.has(sourcePath) &&
						!isFileExcluded(sourcePath, context.excludedFolders)) {
						visited.add(sourcePath);
						results.push({ path: sourcePath, depth: currentDepth, direction: 'backlink' });
						nextLevel.push({ path: sourcePath, depth: currentDepth });
					}
				}
			}
		}

		currentLevel = nextLevel;
	}

	onProgress({
		type: 'tool_call',
		message: `Found ${results.length} linked notes within ${depth} hops`,
		detail: results.slice(0, 5).map(r => `d${r.depth}: ${r.path.split('/').pop()}`).join(', ')
	});

	return JSON.stringify({ notes: results });
}

function isFileExcluded(filePath: string, excludedFolders: string[]): boolean {
	for (const folder of excludedFolders) {
		const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
		if (filePath.startsWith(normalizedFolder)) {
			return true;
		}
		const parentPath = filePath.substring(0, filePath.lastIndexOf('/'));
		if (parentPath === folder) {
			return true;
		}
	}
	return false;
}

/**
 * Run the context agent to find relevant notes
 */
export async function runContextAgent(
	task: string,
	currentFile: TFile,
	currentFileContent: string,
	config: AgenticModeConfig,
	vault: Vault,
	metadataCache: MetadataCache,
	excludedFolders: string[],
	embeddingIndex: EmbeddingIndex | null,
	apiKey: string,
	embeddingModel: EmbeddingModel,
	keywordLimit: number,
	onProgress: (event: AgentProgressEvent) => void
): Promise<ContextAgentResult> {
	const context: ToolHandlerContext = {
		vault,
		metadataCache,
		excludedFolders,
		embeddingIndex,
		apiKey,
		embeddingModel,
		fetchedNotes: new Set([currentFile.path]),
		currentFilePath: currentFile.path,
		currentFileContent,
		keywordLimit
	};

	// Build initial context with current note info
	const initialContext = `User's task: ${task}

Current note (${currentFile.path}):
---
${currentFileContent.substring(0, 4000)}${currentFileContent.length > 4000 ? '\n[... truncated]' : ''}
---

Find the most relevant notes for this task. Remember to call update_selection() after each exploration step!`;

	const messages: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }> = [
		{ role: 'system', content: buildContextAgentSystemPrompt(config.maxNotes) },
		{ role: 'user', content: initialContext }
	];

	const allToolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
	let iteration = 0;
	let finished = false;

	// Running selection state - always have something useful
	let lastSelection: SelectionState | null = null;

	while (iteration < config.maxIterations && !finished) {
		iteration++;
		onProgress({
			type: 'iteration',
			message: `Exploration round ${iteration}/${config.maxIterations}`,
			detail: lastSelection
				? `${lastSelection.selectedPaths.length} notes selected (${lastSelection.confidence})`
				: 'No selection yet'
		});

		// Call OpenAI with tools - enable parallel tool calls
		const response = await requestUrl({
			url: 'https://api.openai.com/v1/chat/completions',
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: config.scoutModel === 'same' ? 'gpt-4o-mini' : config.scoutModel,
				messages: messages,
				tools: CONTEXT_AGENT_TOOLS,
				tool_choice: 'auto',
				parallel_tool_calls: true
			}),
		});

		const data = response.json;
		const assistantMessage = data.choices?.[0]?.message;

		if (!assistantMessage) {
			throw new Error('No response from context agent');
		}

		// Add assistant message to history
		messages.push(assistantMessage);

		// Check for tool calls
		if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
			// Process all tool calls (may be parallel)
			for (const toolCall of assistantMessage.tool_calls) {
				const functionCall = toolCall.function;
				const name = functionCall.name;
				let args: Record<string, unknown> = {};

				try {
					args = JSON.parse(functionCall.arguments || '{}');
				} catch {
					args = {};
				}

				allToolCalls.push({ name, arguments: args });

				// Handle update_selection specially
				if (name === 'update_selection') {
					const selectedPaths = (args.selectedPaths as string[]) || [];
					const reasoning = (args.reasoning as string) || 'No reasoning provided';
					const confidence = (args.confidence as 'exploring' | 'confident' | 'done') || 'exploring';

					lastSelection = { selectedPaths, reasoning, confidence };

					onProgress({
						type: 'tool_call',
						message: `Selection updated (${confidence}): ${selectedPaths.length} notes`,
						detail: reasoning.substring(0, 80)
					});

					// If confidence is 'done', we're finished
					if (confidence === 'done') {
						finished = true;
					}

					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						content: JSON.stringify({
							status: 'selection_updated',
							noteCount: selectedPaths.length,
							confidence
						})
					});
				} else {
					// Handle other tool calls
					const toolResult = await handleToolCall(name, args, context, onProgress);
					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						content: toolResult
					});
				}
			}
		} else {
			// No tool calls - model is done or stuck
			// If we have a selection, use it; otherwise warn
			if (lastSelection) {
				finished = true;
			}
		}
	}

	// Build final result from lastSelection
	let result: ContextAgentResult;

	if (lastSelection && lastSelection.selectedPaths.length > 0) {
		// Ensure current file is included if not already
		let finalPaths = [...lastSelection.selectedPaths];
		if (!finalPaths.includes(currentFile.path)) {
			finalPaths.unshift(currentFile.path);
		}
		// Limit to maxNotes
		finalPaths = finalPaths.slice(0, config.maxNotes);

		result = {
			selectedPaths: finalPaths,
			reasoning: lastSelection.reasoning,
			toolCalls: allToolCalls
		};

		onProgress({
			type: 'complete',
			message: `Selected ${finalPaths.length} notes`,
			detail: lastSelection.reasoning.substring(0, 100)
		});
	} else {
		// No selection was ever made - fallback to current note only
		result = {
			selectedPaths: [currentFile.path],
			reasoning: 'Warning: Agent did not call update_selection(). Only current note included.',
			toolCalls: allToolCalls
		};

		onProgress({
			type: 'complete',
			message: 'Warning: No selection made',
			detail: 'Only current note included - agent did not call update_selection()'
		});
	}

	return result;
}
