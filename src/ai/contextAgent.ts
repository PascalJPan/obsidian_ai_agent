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
	EmbeddingModel,
	ScoutToolConfig,
	NoteSelectionMetadata,
	UserClarificationResponse,
	ScoutFinding
} from '../types';
import { generateEmbedding, searchSemantic } from './semantic';
import { isFileExcluded } from '../utils/fileUtils';
import {
	getAvailableTools,
	buildContextAgentSystemPrompt,
	buildScoutInitialMessage,
	SCOUT_FINAL_ROUND_WARNING,
	buildExplorationStatusMessage,
	MAX_FINDING_CHARS,
	MAX_TOTAL_FINDINGS_CHARS
} from './prompts';

// Agent's running selection (updated throughout exploration)
interface SelectionState {
	selectedPaths: string[];
	reasoning: string;
	confidence: 'exploring' | 'confident' | 'done';
}

// Tracked metadata for selected notes
interface NoteMetadataTracker {
	semanticScores: Map<string, number>;
	keywordMatchTypes: Map<string, 'title' | 'heading' | 'content'>;
	linkDepths: Map<string, number>;
}

// Exploration history for building summary
interface ExplorationStep {
	tool: string;
	query?: string;
	resultCount: number;
	detail?: string;
}

interface ToolHandlerContext {
	vault: Vault;
	metadataCache: MetadataCache;
	excludedFolders: string[];
	embeddingIndex: EmbeddingIndex | null;
	apiKey: string;
	embeddingModel: EmbeddingModel;
	currentFilePath: string | null;
	currentFileContent: string;
	toolConfig: ScoutToolConfig;
	metadataTracker: NoteMetadataTracker;
	explorationSteps: ExplorationStep[];
}

// Serializable form of NoteMetadataTracker for resume state (B6 fix)
interface SerializedMetadataTracker {
	semanticScores: [string, number][];
	keywordMatchTypes: [string, 'title' | 'heading' | 'content'][];
	linkDepths: [string, number][];
}

// Mutable state for the shared agent loop
interface AgentLoopState {
	messages: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }>;
	lastSelection: SelectionState | null;
	allToolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
	findings: ScoutFinding[];
	totalFindingsChars: number;
	totalApiTokens: number;
	iteration: number;
	finished: boolean;
}

function serializeMetadataTracker(tracker: NoteMetadataTracker): SerializedMetadataTracker {
	return {
		semanticScores: [...tracker.semanticScores.entries()],
		keywordMatchTypes: [...tracker.keywordMatchTypes.entries()],
		linkDepths: [...tracker.linkDepths.entries()]
	};
}

function deserializeMetadataTracker(data: SerializedMetadataTracker): NoteMetadataTracker {
	return {
		semanticScores: new Map(data.semanticScores || []),
		keywordMatchTypes: new Map(data.keywordMatchTypes || []),
		linkDepths: new Map(data.linkDepths || [])
	};
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
		case 'view_all_notes':
			return await handleViewAllNotes(args, context, onProgress);
		case 'explore_vault':
			return await handleExploreVault(args, context, onProgress);
		case 'list_all_tags':
			return await handleListAllTags(context, onProgress);
		case 'ask_user':
			return JSON.stringify({ status: 'ask_user_triggered' });
		case 'record_finding':
			return JSON.stringify({ status: 'finding_recorded' });
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
	const limit = Math.min((args.limit as number) || context.toolConfig.listNotesLimit, 50);

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
	const topK = Math.min((args.topK as number) || context.toolConfig.semanticLimit, 20);

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
			0.3
		).filter(m => !isFileExcluded(m.notePath, context.excludedFolders));

		const results: SemanticSearchResult[] = matches.map(m => ({
			path: m.notePath,
			score: Math.round(m.score * 100) / 100,
			heading: m.heading
		}));

		for (const match of matches) {
			context.metadataTracker.semanticScores.set(match.notePath, match.score);
		}

		context.explorationSteps.push({
			tool: 'search_semantic',
			query: query,
			resultCount: results.length
		});

		const previewCount = Math.min(5, results.length);
		onProgress({
			type: 'tool_call',
			message: `Found ${results.length} semantic matches`,
			detail: results.slice(0, previewCount).map(r => r.path.split('/').pop()).join(', ') + (results.length > previewCount ? ', ...' : '')
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

	const file = context.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
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

	const content = await context.vault.cachedRead(file);

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

	if (direction === 'out' || direction === 'both') {
		const cache = context.metadataCache.getFileCache(file);
		for (const link of cache?.links ?? []) {
			const linkedFile = context.metadataCache.getFirstLinkpathDest(link.link, file.path);
			if (linkedFile instanceof TFile && !isFileExcluded(linkedFile.path, context.excludedFolders)) {
				links.push({ path: linkedFile.path, direction: 'outgoing' });
			}
		}
	}

	if (direction === 'in' || direction === 'both') {
		const resolvedLinks = context.metadataCache.resolvedLinks;
		for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
			if (path in targets && !isFileExcluded(sourcePath, context.excludedFolders)) {
				links.push({ path: sourcePath, direction: 'backlink' });
			}
		}
	}

	const previewCount = Math.min(5, links.length);
	onProgress({
		type: 'tool_call',
		message: `Found ${links.length} links`,
		detail: links.slice(0, previewCount).map(l => l.path.split('/').pop()).join(', ') + (links.length > previewCount ? ', ...' : '')
	});

	return JSON.stringify({ links });
}

async function handleSearchKeyword(
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	const keyword = (args.keyword as string || '').toLowerCase().trim();
	const limit = Math.min((args.limit as number) || context.toolConfig.keywordLimit, 20);

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

		if (fileName.includes(keyword)) {
			matchType = 'title';
			priority = 3;
			preview = `Title: ${file.basename}`;
		}

		if (!matchType) {
			const content = await context.vault.cachedRead(file);
			const lines = content.split('\n');

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const lineLower = line.toLowerCase();

				if (lineLower.includes(keyword)) {
					if (line.trim().startsWith('#')) {
						matchType = 'heading';
						priority = 2;
						preview = line.trim();
						break;
					} else if (!matchType) {
						matchType = 'content';
						priority = 1;
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

	results.sort((a, b) => {
		if (b.priority !== a.priority) return b.priority - a.priority;
		return a.path.localeCompare(b.path);
	});

	const limitedResults = results.slice(0, limit).map(r => ({
		path: r.path,
		matchType: r.matchType,
		preview: r.preview
	}));

	for (const result of limitedResults) {
		context.metadataTracker.keywordMatchTypes.set(result.path, result.matchType);
	}

	context.explorationSteps.push({
		tool: 'search_keyword',
		query: keyword,
		resultCount: limitedResults.length,
		detail: limitedResults.slice(0, 3).map(r => `${r.matchType}: ${r.path.split('/').pop()}`).join(', ')
	});

	const keywordPreviewCount = Math.min(5, limitedResults.length);
	onProgress({
		type: 'tool_call',
		message: `Found ${limitedResults.length} keyword matches`,
		detail: limitedResults.slice(0, keywordPreviewCount).map(r => `${r.matchType}: ${r.path.split('/').pop()}`).join(', ') + (limitedResults.length > keywordPreviewCount ? ', ...' : '')
	});

	return JSON.stringify({ results: limitedResults });
}

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
		const currentNoteSummary = context.currentFileContent.substring(0, 500);
		const enhancedQuery = `Task: ${task}\n\nContext from current note: ${currentNoteSummary}`;

		const queryEmbedding = await generateEmbedding(
			enhancedQuery,
			context.apiKey,
			context.embeddingModel
		);

		const excludePaths = context.currentFilePath
			? new Set<string>([context.currentFilePath])
			: new Set<string>();
		const matches = searchSemantic(
			queryEmbedding,
			context.embeddingIndex,
			excludePaths,
			topK,
			0.3
		).filter(m => !isFileExcluded(m.notePath, context.excludedFolders));

		const results: SemanticSearchResult[] = matches.map(m => ({
			path: m.notePath,
			score: Math.round(m.score * 100) / 100,
			heading: m.heading
		}));

		// B4 fix: track semantic scores in metadata (was missing)
		for (const match of matches) {
			context.metadataTracker.semanticScores.set(match.notePath, match.score);
		}

		// B4 fix: track exploration step (was missing)
		context.explorationSteps.push({
			tool: 'search_task_relevant',
			query: task,
			resultCount: results.length
		});

		const taskPreviewCount = Math.min(5, results.length);
		onProgress({
			type: 'tool_call',
			message: `Found ${results.length} task-relevant matches`,
			detail: results.slice(0, taskPreviewCount).map(r => r.path.split('/').pop()).join(', ') + (results.length > taskPreviewCount ? ', ...' : '')
		});

		return JSON.stringify({ results });
	} catch (error) {
		return JSON.stringify({
			error: `Task-relevant search failed: ${(error as Error).message}`,
			results: []
		});
	}
}

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

	const visited = new Set<string>([path]);
	const results: Array<{ path: string; depth: number; direction: 'outgoing' | 'backlink' }> = [];
	let currentLevel: Array<{ path: string; depth: number }> = [{ path, depth: 0 }];

	while (currentLevel.length > 0 && currentLevel[0].depth < depth) {
		const nextLevel: Array<{ path: string; depth: number }> = [];
		const currentDepth = currentLevel[0].depth + 1;

		for (const { path: currentPath } of currentLevel) {
			const currentFile = context.vault.getAbstractFileByPath(currentPath);
			if (!(currentFile instanceof TFile)) continue;

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

	for (const result of results) {
		context.metadataTracker.linkDepths.set(result.path, result.depth);
	}

	context.explorationSteps.push({
		tool: 'get_links_recursive',
		query: `${path} (depth ${depth}, ${direction})`,
		resultCount: results.length
	});

	onProgress({
		type: 'tool_call',
		message: `Found ${results.length} linked notes within ${depth} hops`,
		detail: results.slice(0, 5).map(r => `d${r.depth}: ${r.path.split('/').pop()}`).join(', ')
	});

	return JSON.stringify({ notes: results });
}

async function handleViewAllNotes(
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	const includeAliases = args.includeAliases !== false;
	const includeDescriptions = args.includeDescriptions !== false;

	onProgress({
		type: 'tool_call',
		message: 'Getting all note names with frontmatter',
		detail: `aliases: ${includeAliases}, descriptions: ${includeDescriptions}`
	});

	const allFiles = context.vault.getMarkdownFiles();
	const filtered = allFiles.filter(f => !isFileExcluded(f.path, context.excludedFolders));

	const notes: Array<{ path: string; aliases?: string[]; description?: string }> = [];

	for (const file of filtered) {
		const noteInfo: { path: string; aliases?: string[]; description?: string } = {
			path: file.path
		};

		const cache = context.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;

		if (frontmatter) {
			if (includeAliases && frontmatter.aliases) {
				if (Array.isArray(frontmatter.aliases)) {
					noteInfo.aliases = frontmatter.aliases;
				} else if (typeof frontmatter.aliases === 'string') {
					noteInfo.aliases = [frontmatter.aliases];
				}
			}
			if (includeDescriptions && frontmatter.description) {
				noteInfo.description = String(frontmatter.description);
			}
		}

		notes.push(noteInfo);
	}

	notes.sort((a, b) => a.path.localeCompare(b.path));

	const notesWithMeta = notes.filter(n => n.aliases || n.description).length;
	onProgress({
		type: 'tool_call',
		message: `Found ${notes.length} notes (${notesWithMeta} with metadata)`,
		detail: notes.slice(0, 5).map(n => n.path.split('/').pop()).join(', ') + (notes.length > 5 ? ', ...' : '')
	});

	return JSON.stringify({ notes, total: notes.length });
}

async function handleExploreVault(
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	const action = args.action as string;

	if (action === 'list_folder') {
		return await handleListFolder(args, context, onProgress);
	} else if (action === 'find_by_tag') {
		return await handleFindByTag(args, context, onProgress);
	} else {
		return JSON.stringify({ error: `Unknown action: ${action}. Use "list_folder" or "find_by_tag"` });
	}
}

async function handleListFolder(
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	const folderPath = (args.folder as string) || '';
	const recursive = args.recursive === true;

	onProgress({
		type: 'tool_call',
		message: `Listing folder: ${folderPath || '(root)'}`,
		detail: recursive ? 'recursive' : 'direct children only'
	});

	const allFiles = context.vault.getMarkdownFiles();
	const folders = new Set<string>();
	const files: string[] = [];

	const normalizedFolder = folderPath === '/' ? '' : folderPath;
	const folderPrefix = normalizedFolder ? (normalizedFolder.endsWith('/') ? normalizedFolder : normalizedFolder + '/') : '';

	for (const file of allFiles) {
		if (isFileExcluded(file.path, context.excludedFolders)) continue;

		if (normalizedFolder === '') {
			if (recursive) {
				files.push(file.path);
				const parts = file.path.split('/');
				for (let i = 1; i < parts.length; i++) {
					const folderPart = parts.slice(0, i).join('/');
					if (!isFileExcluded(folderPart, context.excludedFolders)) {
						folders.add(folderPart);
					}
				}
			} else {
				if (!file.path.includes('/')) {
					files.push(file.path);
				} else {
					const topFolder = file.path.split('/')[0];
					if (!isFileExcluded(topFolder, context.excludedFolders)) {
						folders.add(topFolder);
					}
				}
			}
		} else {
			if (file.path.startsWith(folderPrefix)) {
				const relativePath = file.path.substring(folderPrefix.length);
				if (recursive) {
					files.push(file.path);
					const parts = relativePath.split('/');
					for (let i = 1; i < parts.length; i++) {
						const subFolder = folderPrefix + parts.slice(0, i).join('/');
						if (!isFileExcluded(subFolder, context.excludedFolders)) {
							folders.add(subFolder);
						}
					}
				} else {
					if (!relativePath.includes('/')) {
						files.push(file.path);
					} else {
						const immediateChild = folderPrefix + relativePath.split('/')[0];
						if (!isFileExcluded(immediateChild, context.excludedFolders)) {
							folders.add(immediateChild);
						}
					}
				}
			}
		}
	}

	const sortedFolders = [...folders].sort();
	const sortedFiles = files.sort();

	onProgress({
		type: 'tool_call',
		message: `Found ${sortedFolders.length} folders, ${sortedFiles.length} files`,
		detail: sortedFiles.slice(0, 3).map(f => f.split('/').pop()).join(', ') + (sortedFiles.length > 3 ? ', ...' : '')
	});

	return JSON.stringify({
		folder: folderPath || '(root)',
		folders: sortedFolders,
		files: sortedFiles
	});
}

async function handleFindByTag(
	args: Record<string, unknown>,
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	const rawTag = (args.tag as string) || '';
	const tag = rawTag.startsWith('#') ? rawTag.substring(1) : rawTag;

	if (!tag) {
		return JSON.stringify({ error: 'Tag is required', matches: [] });
	}

	onProgress({
		type: 'tool_call',
		message: `Finding notes with tag: #${tag}`,
		detail: 'Searching content and frontmatter'
	});

	const allFiles = context.vault.getMarkdownFiles();
	const matches: string[] = [];

	for (const file of allFiles) {
		if (isFileExcluded(file.path, context.excludedFolders)) continue;

		const cache = context.metadataCache.getFileCache(file);
		let hasTag = false;

		if (cache?.tags) {
			for (const tagRef of cache.tags) {
				const inlineTag = tagRef.tag.substring(1);
				if (inlineTag === tag || inlineTag.startsWith(tag + '/')) {
					hasTag = true;
					break;
				}
			}
		}

		if (!hasTag && cache?.frontmatter?.tags) {
			const fmTags = cache.frontmatter.tags;
			if (Array.isArray(fmTags)) {
				for (const fmTag of fmTags) {
					const normalizedFmTag = String(fmTag).startsWith('#') ? String(fmTag).substring(1) : String(fmTag);
					if (normalizedFmTag === tag || normalizedFmTag.startsWith(tag + '/')) {
						hasTag = true;
						break;
					}
				}
			} else if (typeof fmTags === 'string') {
				const normalizedFmTag = fmTags.startsWith('#') ? fmTags.substring(1) : fmTags;
				if (normalizedFmTag === tag || normalizedFmTag.startsWith(tag + '/')) {
					hasTag = true;
				}
			}
		}

		if (hasTag) {
			matches.push(file.path);
		}
	}

	matches.sort();

	onProgress({
		type: 'tool_call',
		message: `Found ${matches.length} notes with #${tag}`,
		detail: matches.slice(0, 5).map(p => p.split('/').pop()).join(', ') + (matches.length > 5 ? ', ...' : '')
	});

	return JSON.stringify({ tag: '#' + tag, matches });
}

async function handleListAllTags(
	context: ToolHandlerContext,
	onProgress: (event: AgentProgressEvent) => void
): Promise<string> {
	onProgress({
		type: 'tool_call',
		message: 'Listing all vault tags',
		detail: 'Scanning notes for tags'
	});

	const tagCounts = new Map<string, number>();
	const allFiles = context.vault.getMarkdownFiles();

	for (const file of allFiles) {
		if (isFileExcluded(file.path, context.excludedFolders)) continue;

		const cache = context.metadataCache.getFileCache(file);

		if (cache?.tags) {
			for (const tagRef of cache.tags) {
				const tag = tagRef.tag.substring(1);
				tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
			}
		}

		if (cache?.frontmatter?.tags) {
			const fmTags = cache.frontmatter.tags;
			const tagArray = Array.isArray(fmTags) ? fmTags : [fmTags];
			for (const fmTag of tagArray) {
				const normalizedTag = String(fmTag).startsWith('#') ? String(fmTag).substring(1) : String(fmTag);
				tagCounts.set(normalizedTag, (tagCounts.get(normalizedTag) || 0) + 1);
			}
		}
	}

	const tags = [...tagCounts.entries()]
		.map(([tag, count]) => ({ tag: '#' + tag, count }))
		.sort((a, b) => b.count - a.count);

	context.explorationSteps.push({
		tool: 'list_all_tags',
		resultCount: tags.length,
		detail: tags.slice(0, 5).map(t => `${t.tag}(${t.count})`).join(', ')
	});

	onProgress({
		type: 'tool_call',
		message: `Found ${tags.length} tags`,
		detail: tags.slice(0, 5).map(t => `${t.tag}(${t.count})`).join(', ') + (tags.length > 5 ? ', ...' : '')
	});

	return JSON.stringify({ tags, total: tags.length });
}

// ============================================
// Shared Agent Loop (M1 refactor)
// ============================================

/**
 * Process one batch of tool calls from an API response.
 * Single source of truth for handling update_selection, ask_user,
 * record_finding, and all other tools. Fixes B2 (token budget feedback),
 * B3 (iteration status), and B6 (metadata persistence) by ensuring both
 * runContextAgent and continueContextAgent use identical logic.
 */
async function processToolCalls(
	toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>,
	loopState: AgentLoopState,
	toolContext: ToolHandlerContext,
	config: AgenticModeConfig,
	currentFile: TFile | null,
	estimateSelectionTokens: (paths: string[]) => Promise<number>,
	onProgress: (event: AgentProgressEvent) => void
): Promise<{ action: 'continue'; finished: boolean } | { action: 'waiting_for_user'; result: ContextAgentResult }> {
	let finished = false;

	for (const toolCall of toolCalls) {
		const functionCall = toolCall.function;
		const name = functionCall.name;
		let args: Record<string, unknown> = {};

		try {
			args = JSON.parse(functionCall.arguments || '{}');
		} catch {
			args = {};
		}

		loopState.allToolCalls.push({ name, arguments: args });

		if (name === 'update_selection') {
			const rawPaths = (args.selectedPaths as string[]) || [];
			const selectedPaths = rawPaths.filter(p => !isFileExcluded(p, toolContext.excludedFolders));
			const filteredCount = rawPaths.length - selectedPaths.length;
			const reasoning = (args.reasoning as string) || 'No reasoning provided';
			const confidence = (args.confidence as 'exploring' | 'confident' | 'done') || 'exploring';

			loopState.lastSelection = { selectedPaths, reasoning, confidence };

			onProgress({
				type: 'tool_call',
				message: `Selection updated (${confidence}): ${selectedPaths.length} notes${filteredCount > 0 ? ` (${filteredCount} excluded)` : ''}`,
				detail: reasoning.substring(0, 80)
			});

			if (confidence === 'done') {
				finished = true;
			}

			const toolResponse: Record<string, unknown> = {
				status: 'selection_updated',
				noteCount: selectedPaths.length,
				confidence
			};

			if (filteredCount > 0) {
				toolResponse.warning = `${filteredCount} path(s) were in excluded folders and have been removed from selection.`;
			}

			// B2 fix: token budget feedback now shared (was missing in continueContextAgent)
			if (config.showTokenBudget && config.tokenLimit) {
				const estimatedTokens = await estimateSelectionTokens(selectedPaths);
				toolResponse.estimatedTokens = estimatedTokens;
				toolResponse.tokenBudget = config.tokenLimit;
				toolResponse.budgetStatus = estimatedTokens > config.tokenLimit
					? `OVER BUDGET by ${(estimatedTokens - config.tokenLimit).toLocaleString()} tokens - consider removing notes`
					: `Within budget (${Math.round(estimatedTokens / config.tokenLimit * 100)}% used)`;
			}

			loopState.messages.push({
				role: 'tool',
				tool_call_id: toolCall.id,
				content: JSON.stringify(toolResponse)
			});
		} else if (name === 'ask_user') {
			const question = (args.question as string) || 'Could you clarify?';
			const options = args.options as string[] | undefined;

			onProgress({
				type: 'tool_call',
				message: 'Asking user for clarification',
				detail: question.substring(0, 60)
			});

			const fallbackPaths = currentFile ? [currentFile.path] : [];
			const selectedNotes = buildSelectedNotesMetadata(
				loopState.lastSelection?.selectedPaths || fallbackPaths,
				currentFile?.path || null,
				toolContext.metadataTracker
			);

			const explorationSummary = buildExplorationSummary(toolContext.explorationSteps);

			// B6 fix: serialize metadataTracker and explorationSteps into resume state
			return {
				action: 'waiting_for_user',
				result: {
					selectedPaths: loopState.lastSelection?.selectedPaths || fallbackPaths,
					selectedNotes,
					reasoning: loopState.lastSelection?.reasoning || 'Exploration paused for user clarification.',
					confidence: loopState.lastSelection?.confidence || 'exploring',
					explorationSummary,
					toolCalls: loopState.allToolCalls,
					findings: loopState.findings,
					tokensUsed: loopState.totalApiTokens,
					status: 'waiting_for_user',
					userQuestion: { question, options },
					_resumeState: JSON.stringify({
						messages: loopState.messages,
						lastSelection: loopState.lastSelection,
						iteration: loopState.iteration,
						pendingToolCallId: toolCall.id,
						findings: loopState.findings,
						metadataTracker: serializeMetadataTracker(toolContext.metadataTracker),
						explorationSteps: toolContext.explorationSteps
					})
				}
			};
		} else if (name === 'record_finding') {
			const label = (args.label as string) || 'Finding';
			let data = (args.data as string) || '';

			if (data.length > MAX_FINDING_CHARS) {
				data = data.substring(0, MAX_FINDING_CHARS) + '\n[... truncated]';
			}

			if (loopState.totalFindingsChars + data.length > MAX_TOTAL_FINDINGS_CHARS) {
				const remaining = MAX_TOTAL_FINDINGS_CHARS - loopState.totalFindingsChars;
				if (remaining > 100) {
					data = data.substring(0, remaining) + '\n[... truncated due to total findings limit]';
				} else {
					loopState.messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						content: JSON.stringify({ status: 'error', error: 'Total findings limit reached. Cannot record more findings.' })
					});
					continue;
				}
			}

			loopState.findings.push({ label, data });
			loopState.totalFindingsChars += data.length;

			onProgress({
				type: 'tool_call',
				message: `Finding recorded: ${label}`,
				detail: `${data.length} chars (${loopState.findings.length} total findings)`
			});

			loopState.messages.push({
				role: 'tool',
				tool_call_id: toolCall.id,
				content: JSON.stringify({ status: 'finding_recorded', label, totalFindings: loopState.findings.length })
			});
		} else {
			const toolResult = await handleToolCall(name, args, toolContext, onProgress);
			loopState.messages.push({
				role: 'tool',
				tool_call_id: toolCall.id,
				content: toolResult
			});
		}
	}

	return { action: 'continue', finished };
}

/**
 * Run the shared agent loop. Used by both runContextAgent and continueContextAgent.
 */
async function runAgentLoop(
	loopState: AgentLoopState,
	toolContext: ToolHandlerContext,
	config: AgenticModeConfig,
	apiKey: string,
	currentFile: TFile | null,
	estimateSelectionTokens: (paths: string[]) => Promise<number>,
	onProgress: (event: AgentProgressEvent) => void
): Promise<ContextAgentResult | null> {
	while (loopState.iteration < config.maxIterations && !loopState.finished) {
		loopState.iteration++;
		const isLastIteration = loopState.iteration === config.maxIterations;

		onProgress({
			type: 'iteration',
			message: `Exploration round ${loopState.iteration}/${config.maxIterations}${isLastIteration ? ' (FINAL)' : ''}`,
			detail: loopState.lastSelection
				? `${loopState.lastSelection.selectedPaths.length} notes selected (${loopState.lastSelection.confidence})`
				: 'No selection yet'
		});

		const availableTools = getAvailableTools(toolContext.toolConfig);

		if (isLastIteration) {
			loopState.messages.push({
				role: 'user',
				content: SCOUT_FINAL_ROUND_WARNING
			});
		}

		// G3 fix: wrap API call in try-catch
		let data: Record<string, unknown>;
		try {
			const response = await requestUrl({
				url: 'https://api.openai.com/v1/chat/completions',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: config.scoutModel === 'same' ? 'gpt-4o-mini' : config.scoutModel,
					messages: loopState.messages,
					tools: availableTools,
					tool_choice: 'auto',
					parallel_tool_calls: true
				}),
			});
			data = response.json;
		} catch (error) {
			const errMsg = (error as Error).message || 'Unknown network error';
			throw new Error(`Scout Agent API call failed: ${errMsg}`);
		}

		loopState.totalApiTokens += (data.usage as Record<string, number>)?.total_tokens ?? 0;
		const assistantMessage = (data.choices as Array<{ message: Record<string, unknown> }>)?.[0]?.message;

		if (!assistantMessage) {
			throw new Error('No response from context agent');
		}

		loopState.messages.push(assistantMessage as AgentLoopState['messages'][0]);

		const msgToolCalls = assistantMessage.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
		if (msgToolCalls && msgToolCalls.length > 0) {
			const batchResult = await processToolCalls(
				msgToolCalls, loopState, toolContext, config,
				currentFile, estimateSelectionTokens, onProgress
			);

			if (batchResult.action === 'waiting_for_user') {
				return batchResult.result;
			}

			if (batchResult.finished) {
				loopState.finished = true;
			}

			// B3 fix: iteration status now shared (was missing in continueContextAgent)
			if (!loopState.finished && loopState.iteration < config.maxIterations) {
				loopState.messages.push({
					role: 'user',
					content: buildExplorationStatusMessage(
						loopState.iteration,
						config.maxIterations,
						loopState.lastSelection ? loopState.lastSelection.selectedPaths.length : null
					)
				});
			}
		} else {
			if (loopState.lastSelection) {
				loopState.finished = true;
			}
		}
	}

	return null;
}

/**
 * Build the final ContextAgentResult from loop state, with semantic fallback if needed.
 */
async function buildFinalResult(
	loopState: AgentLoopState,
	toolContext: ToolHandlerContext,
	task: string,
	currentFile: TFile | null,
	excludedFolders: string[],
	embeddingIndex: EmbeddingIndex | null,
	apiKey: string,
	embeddingModel: EmbeddingModel,
	config: AgenticModeConfig,
	onProgress: (event: AgentProgressEvent) => void
): Promise<ContextAgentResult> {
	const explorationSummary = buildExplorationSummary(toolContext.explorationSteps);

	if (loopState.lastSelection && (loopState.lastSelection.selectedPaths.length > 0 || loopState.findings.length > 0)) {
		let finalPaths = [...loopState.lastSelection.selectedPaths];
		finalPaths = finalPaths.slice(0, config.maxNotes);

		const selectedNotes = buildSelectedNotesMetadata(finalPaths, currentFile?.path || null, toolContext.metadataTracker);

		onProgress({
			type: 'complete',
			message: `Selected ${finalPaths.length} notes`,
			detail: loopState.lastSelection.reasoning.substring(0, 100)
		});

		return {
			selectedPaths: finalPaths,
			selectedNotes,
			reasoning: loopState.lastSelection.reasoning,
			confidence: loopState.lastSelection.confidence,
			explorationSummary,
			toolCalls: loopState.allToolCalls,
			findings: loopState.findings,
			tokensUsed: loopState.totalApiTokens,
			status: 'complete'
		};
	}

	// No selection — semantic fallback
	let fallbackPaths: string[] = currentFile ? [currentFile.path] : [];
	let fallbackReasoning = 'Warning: Agent did not call update_selection().';

	if (embeddingIndex) {
		try {
			onProgress({ type: 'tool_call', message: 'Running semantic fallback search', detail: 'Agent did not make a selection' });
			const taskEmbedding = await generateEmbedding(task, apiKey, embeddingModel);
			const excludePaths = currentFile ? new Set<string>([currentFile.path]) : new Set<string>();
			const semanticMatches = searchSemantic(taskEmbedding, embeddingIndex, excludePaths, 5, 0.4)
				.filter(m => !isFileExcluded(m.notePath, excludedFolders));

			if (semanticMatches.length > 0) {
				for (const match of semanticMatches) {
					fallbackPaths.push(match.notePath);
				}
				fallbackReasoning = `Agent did not call update_selection(). Fallback: semantic search found ${semanticMatches.length} relevant notes.`;
				onProgress({
					type: 'tool_call',
					message: `Semantic fallback found ${semanticMatches.length} notes`,
					detail: semanticMatches.map(m => m.notePath.split('/').pop()).join(', ')
				});
			}
		} catch (error) {
			console.warn('Semantic fallback failed:', error);
			fallbackReasoning += ' Semantic fallback also failed.';
		}
	}

	const selectedNotes = buildSelectedNotesMetadata(fallbackPaths, currentFile?.path || null, toolContext.metadataTracker);
	const hasNotes = fallbackPaths.length > 0;

	onProgress({
		type: 'complete',
		message: fallbackPaths.length > 1
			? `Fallback: ${fallbackPaths.length} notes (semantic)`
			: fallbackPaths.length === 1
				? 'Warning: Only current note selected'
				: 'Warning: No notes selected',
		detail: fallbackPaths.length > 1
			? 'Used semantic search as fallback'
			: fallbackPaths.length === 1
				? 'Agent did not call update_selection()'
				: 'No current file and agent did not call update_selection()'
	});

	return {
		selectedPaths: fallbackPaths,
		selectedNotes,
		reasoning: fallbackReasoning + (hasNotes ? ' Using fallback notes.' : ' No notes selected.'),
		confidence: 'done',
		explorationSummary: explorationSummary || 'No exploration performed.',
		toolCalls: loopState.allToolCalls,
		findings: loopState.findings,
		tokensUsed: loopState.totalApiTokens,
		status: 'complete'
	};
}

// ============================================
// Public API
// ============================================

/**
 * Run the context agent to find relevant notes
 */
export async function runContextAgent(
	task: string,
	currentFile: TFile | null,
	currentFileContent: string,
	config: AgenticModeConfig,
	vault: Vault,
	metadataCache: MetadataCache,
	excludedFolders: string[],
	embeddingIndex: EmbeddingIndex | null,
	apiKey: string,
	embeddingModel: EmbeddingModel,
	toolConfig: ScoutToolConfig,
	onProgress: (event: AgentProgressEvent) => void
): Promise<ContextAgentResult> {
	const metadataTracker: NoteMetadataTracker = {
		semanticScores: new Map(),
		keywordMatchTypes: new Map(),
		linkDepths: new Map()
	};
	const explorationSteps: ExplorationStep[] = [];

	const toolContext: ToolHandlerContext = {
		vault, metadataCache, excludedFolders, embeddingIndex, apiKey, embeddingModel,
		currentFilePath: currentFile?.path || null,
		currentFileContent, toolConfig, metadataTracker, explorationSteps
	};

	const initialContext = buildScoutInitialMessage(task, currentFile?.path || null, currentFileContent);

	const messages: AgentLoopState['messages'] = [
		{ role: 'system', content: buildContextAgentSystemPrompt(config.maxNotes, config.tokenLimit, config.showTokenBudget, toolConfig.askUser) },
		{ role: 'user', content: initialContext }
	];

	const estimateSelectionTokens = async (paths: string[]): Promise<number> => {
		let total = 0;
		for (const path of paths) {
			try {
				const file = vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					const content = await vault.cachedRead(file);
					total += Math.ceil(content.length / 4);
				}
			} catch { /* ignore */ }
		}
		return total;
	};

	const loopState: AgentLoopState = {
		messages, lastSelection: null, allToolCalls: [], findings: [],
		totalFindingsChars: 0, totalApiTokens: 0, iteration: 0, finished: false
	};

	const earlyResult = await runAgentLoop(loopState, toolContext, config, apiKey, currentFile, estimateSelectionTokens, onProgress);
	if (earlyResult) return earlyResult;

	return buildFinalResult(loopState, toolContext, task, currentFile, excludedFolders, embeddingIndex, apiKey, embeddingModel, config, onProgress);
}

/**
 * Build selected notes metadata from tracker
 */
function buildSelectedNotesMetadata(
	paths: string[],
	currentFilePath: string | null,
	tracker: NoteMetadataTracker
): NoteSelectionMetadata[] {
	return paths.map(path => {
		let selectionReason: NoteSelectionMetadata['selectionReason'] = 'manual';

		if (currentFilePath && path === currentFilePath) {
			selectionReason = 'current';
		} else if (tracker.semanticScores.has(path)) {
			selectionReason = 'semantic';
		} else if (tracker.keywordMatchTypes.has(path)) {
			selectionReason = 'keyword';
		} else if (tracker.linkDepths.has(path)) {
			selectionReason = 'linked';
		}

		const metadata: NoteSelectionMetadata = { path, selectionReason };
		const semanticScore = tracker.semanticScores.get(path);
		const keywordMatchType = tracker.keywordMatchTypes.get(path);
		const linkDepth = tracker.linkDepths.get(path);

		if (semanticScore !== undefined || keywordMatchType !== undefined || linkDepth !== undefined) {
			metadata.scoutMetadata = {};
			if (semanticScore !== undefined) metadata.scoutMetadata.semanticScore = semanticScore;
			if (keywordMatchType !== undefined) metadata.scoutMetadata.keywordMatchType = keywordMatchType;
			if (linkDepth !== undefined) metadata.scoutMetadata.linkDepth = linkDepth;
		}

		return metadata;
	});
}

/**
 * Build human-readable exploration summary
 */
function buildExplorationSummary(steps: ExplorationStep[]): string {
	if (steps.length === 0) return 'No exploration steps performed.';

	const summaryParts: string[] = [];

	for (const step of steps) {
		switch (step.tool) {
			case 'search_keyword':
				summaryParts.push(`Searched "${step.query}" → ${step.resultCount} keyword matches`);
				break;
			case 'search_semantic':
				summaryParts.push(`Semantic search "${step.query?.substring(0, 30)}..." → ${step.resultCount} matches`);
				break;
			case 'search_task_relevant':
				summaryParts.push(`Task-relevant search "${step.query?.substring(0, 30)}..." → ${step.resultCount} matches`);
				break;
			case 'get_links_recursive':
				summaryParts.push(`Explored links ${step.query} → ${step.resultCount} notes`);
				break;
			case 'list_all_tags':
				summaryParts.push(`Listed ${step.resultCount} tags`);
				break;
			default:
				if (step.resultCount > 0) {
					summaryParts.push(`${step.tool}: ${step.resultCount} results`);
				}
		}
	}

	return summaryParts.join('. ') + '.';
}

/**
 * Continue context agent after user responds to ask_user
 */
export async function continueContextAgent(
	resumeState: string,
	userResponse: UserClarificationResponse,
	task: string,
	currentFile: TFile | null,
	currentFileContent: string,
	config: AgenticModeConfig,
	vault: Vault,
	metadataCache: MetadataCache,
	excludedFolders: string[],
	embeddingIndex: EmbeddingIndex | null,
	apiKey: string,
	embeddingModel: EmbeddingModel,
	toolConfig: ScoutToolConfig,
	onProgress: (event: AgentProgressEvent) => void
): Promise<ContextAgentResult> {
	const state = JSON.parse(resumeState) as {
		messages: AgentLoopState['messages'];
		lastSelection: SelectionState | null;
		iteration: number;
		pendingToolCallId: string;
		findings?: ScoutFinding[];
		metadataTracker?: SerializedMetadataTracker;
		explorationSteps?: ExplorationStep[];
	};

	// B6 fix: restore metadata tracker from resume state (instead of re-initializing empty)
	const metadataTracker: NoteMetadataTracker = state.metadataTracker
		? deserializeMetadataTracker(state.metadataTracker)
		: { semanticScores: new Map(), keywordMatchTypes: new Map(), linkDepths: new Map() };

	const explorationSteps: ExplorationStep[] = state.explorationSteps || [];

	const toolContext: ToolHandlerContext = {
		vault, metadataCache, excludedFolders, embeddingIndex, apiKey, embeddingModel,
		currentFilePath: currentFile?.path || null,
		currentFileContent, toolConfig, metadataTracker, explorationSteps
	};

	let responseText = userResponse.answer;
	if (userResponse.selectedOption !== undefined) {
		responseText = `User selected option ${userResponse.selectedOption}: ${userResponse.answer}`;
	}

	state.messages.push({
		role: 'tool',
		tool_call_id: state.pendingToolCallId,
		content: JSON.stringify({ status: 'user_responded', response: responseText })
	});

	const findings: ScoutFinding[] = state.findings || [];

	const estimateSelectionTokens = async (paths: string[]): Promise<number> => {
		let total = 0;
		for (const path of paths) {
			try {
				const file = vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					const content = await vault.cachedRead(file);
					total += Math.ceil(content.length / 4);
				}
			} catch { /* ignore */ }
		}
		return total;
	};

	const loopState: AgentLoopState = {
		messages: state.messages,
		lastSelection: state.lastSelection,
		allToolCalls: [],
		findings,
		totalFindingsChars: findings.reduce((sum, f) => sum + f.data.length, 0),
		totalApiTokens: 0,
		iteration: state.iteration,
		finished: false
	};

	const earlyResult = await runAgentLoop(loopState, toolContext, config, apiKey, currentFile, estimateSelectionTokens, onProgress);
	if (earlyResult) return earlyResult;

	return buildFinalResult(loopState, toolContext, task, currentFile, excludedFolders, embeddingIndex, apiKey, embeddingModel, config, onProgress);
}
