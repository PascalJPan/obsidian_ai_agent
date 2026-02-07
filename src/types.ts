/**
 * Shared type definitions for ObsidianAgent Plugin
 */

import { TFile } from 'obsidian';

// Type definitions
export type EditableScope = 'current' | 'linked' | 'context';

// Context scope configuration
export type LinkDepth = 0 | 1 | 2 | 3;

export interface ContextScopeConfig {
	linkDepth: LinkDepth;           // 0=current only, 1=direct links, 2-3=deeper traversal
	maxLinkedNotes: number;         // 0-50, 0 = use all linked notes
	maxFolderNotes: number;         // 0-20, 0 = none (replaces includeSameFolder)
	semanticMatchCount: number;     // 0-20, 0 = none (replaces includeSemanticMatches)
	semanticMinSimilarity: number;  // 0-100, percentage threshold for semantic matches
	manuallyAddedNotes?: string[];  // Paths of notes manually added via picker
}

// Embedding types for semantic search
export type EmbeddingModel = 'text-embedding-3-small' | 'text-embedding-3-large';

export interface EmbeddingChunk {
	notePath: string;
	heading: string;        // Empty string if no heading (preamble or whole note)
	content: string;
	hash: string;           // sha256(heading + content)
	embedding: number[];    // 1536 dims (small) or 3072 dims (large)
}

export interface EmbeddingIndex {
	model: EmbeddingModel;
	lastUpdated: string;    // ISO timestamp
	chunks: EmbeddingChunk[];
}

// Frontmatter metadata for context display
export interface NoteFrontmatter {
	path: string;
	aliases?: string[];
	description?: string;
}

// Context info for preview modal
export interface ContextInfo {
	currentNote: string;
	linkedNotes: string[];
	folderNotes: string[];
	semanticNotes: { path: string; score: number }[];
	manualNotes: string[];  // Manually added notes via picker
	totalTokenEstimate: number;
	// Optional frontmatter metadata for enhanced display
	frontmatter?: Map<string, NoteFrontmatter>;
}

export interface AICapabilities {
	canAdd: boolean;
	canDelete: boolean;
	canCreate: boolean;
	canNavigate: boolean;  // Can open notes in new tabs
}

// Interfaces for JSON-based multi-note editing
export interface EditInstruction {
	file: string;
	position: string;
	content: string;
}

export interface AIEditResponse {
	edits: EditInstruction[];
	summary: string;
}

export interface ValidatedEdit {
	instruction: EditInstruction;
	resolvedFile: TFile | null;
	currentContent: string;
	newContent: string;
	error: string | null;
	isNewFile?: boolean;
}

// Diff preview interfaces
export interface DiffLine {
	type: 'unchanged' | 'added' | 'removed';
	lineNumber?: number;
	newLineNumber?: number;
	content: string;
}

// Token usage from API response
export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

// Inline edit data structure
export interface InlineEdit {
	id: string;
	type: 'replace' | 'add' | 'delete';
	before: string;
	after: string;
	file?: string;
}

// Progress event for live UI updates
export interface AgentProgressEvent {
	type: 'tool_call' | 'tool_result' | 'thinking' | 'iteration' | 'complete';
	message: string;
	detail?: string;
	fullContent?: string;  // tool result string or thinking text
}

// Note preview for agent
export interface NotePreview {
	path: string;
	name: string;
	preview: string;    // First ~200 chars
	tags?: string[];    // Tags from frontmatter
}

// Semantic search result for agent
export interface SemanticSearchResult {
	notePath: string;
	score: number;
	heading: string;
}

// Link info for agent
export interface LinkInfo {
	path: string;
	name?: string;
	direction: 'outgoing' | 'backlink' | 'incoming' | 'both';
	depth?: number;
}

// Token-limited context result for smart note removal
export interface TokenLimitedContextResult {
	context: string;
	removedNotes: string[];
	totalTokens: number;
}

// Chat message interface with rich context for AI memory
export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: Date;
	// Message type for special messages
	type?: 'message' | 'context-switch';  // Default is 'message'
	// Context for AI memory
	activeFile?: string;           // Path of active file when message was sent
	proposedEdits?: EditInstruction[];  // Edits the AI proposed (for assistant messages)
	editResults?: {                // Results of applying edits
		success: number;
		failed: number;
		failures: Array<{ file: string; error: string }>;
		accepted?: number;
		rejected?: number;
		pending?: number;
	};
	// Token usage from API response (for assistant messages)
	tokenUsage?: TokenUsage;
	// Model used for this response (for accurate historical cost display)
	model?: string;
	// Web agent results (for assistant messages in agentic mode)
	webSources?: WebSource[];
	// Notes the agent read during processing
	notesRead?: string[];
}

// Web search types (used by unified agent)
export type SearchApiType = 'openai' | 'serper' | 'brave' | 'tavily';

export interface WebSource {
	url: string;
	title: string;
	summary: string;
}

// ============================================
// Unified Agent Types
// ============================================

export interface QueryOptions {
	modified_after?: string;   // ISO date string
	modified_before?: string;
	has_property?: string;
	sort_by?: 'name' | 'modified' | 'created';
	limit?: number;
}

export interface QueryResult {
	path: string;
	matchingProperties?: Record<string, unknown>;
	modified?: number;
	created?: number;
}

export interface DeadLinkResult {
	source: string;
	deadLink: string;
}

export interface FileInfo {
	created: number;
	modified: number;
	size: number;
}

export interface CommandInfo {
	id: string;
	name: string;
}

export interface WhitelistedCommand {
	id: string;
	name: string;
	description: string;
}

export interface AgentConfig {
	model: string;
	apiKey: string;
	capabilities: AICapabilities;
	editableScope: EditableScope;
	maxIterations: number;      // 5-20, default 10
	maxTotalTokens: number;     // token budget across all rounds
	webEnabled: boolean;
	webSearchApi?: SearchApiType;
	webSearchApiKey?: string;
	webSnippetLimit?: number;
	webFetchLimit?: number;
	webTokenBudget?: number;
	disabledTools: string[];        // Tool names disabled by user (e.g., ['list_tags', 'move_note'])
	whitelistedCommands: WhitelistedCommand[];
	customPrompts?: { character?: string };
	chatHistoryLength: number;
	debugMode: boolean;
}

export interface KeywordResult {
	path: string;
	name: string;
	matchType: 'title' | 'heading' | 'content';
	matchContext: string;
}

export interface AgentCallbacks {
	// Vault reading
	readNote(path: string): Promise<{ content: string; path: string; lineCount: number; excluded?: boolean } | null>;
	searchKeyword(query: string, limit: number): Promise<KeywordResult[]>;
	searchSemantic(query: string, topK: number): Promise<SemanticSearchResult[]>;
	listNotes(folder?: string, limit?: number): Promise<NotePreview[]>;
	getLinks(path: string, direction: string, depth?: number): Promise<LinkInfo[]>;
	exploreStructure(action: string, args: Record<string, unknown>): Promise<string>;
	listTags(): Promise<{ tag: string; count: number }[]>;
	getAllNotes(includeMetadata?: boolean): Promise<{ path: string; aliases?: string[]; description?: string }[]>;
	getManualContext(): Promise<string>;
	// Web
	webSearch?(query: string, limit: number): Promise<{ title: string; url: string; snippet: string }[]>;
	fetchPage?(url: string, maxTokens: number): Promise<{ content: string; title: string }>;
	// Core actions
	proposeEdit(edit: EditInstruction): Promise<{ success: boolean; error?: string }>;
	createNote(path: string, content: string): Promise<{ success: boolean; error?: string }>;
	openNote(path: string): Promise<{ success: boolean; error?: string }>;
	// Organization actions
	moveNote(from: string, to: string): Promise<{ success: boolean; newPath?: string; error?: string }>;
	updateProperties(path: string, props: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
	addTags(path: string, tags: string[]): Promise<{ success: boolean; error?: string }>;
	linkNotes(source: string, target: string, context?: string): Promise<{ success: boolean; error?: string }>;
	// Copy notes (returns formatted content for clipboard)
	copyNotes(paths: string[]): Promise<{ content: string; noteCount: number }>;
	// Advanced vault reading (optional — controlled by tool toggles)
	getProperties?(path: string): Promise<Record<string, unknown> | null>;
	getFileInfo?(path: string): Promise<FileInfo | null>;
	findDeadLinks?(path?: string): Promise<DeadLinkResult[]>;
	queryNotes?(filter: Record<string, unknown>, options: QueryOptions): Promise<QueryResult[]>;
	// Destructive actions (optional — controlled by tool toggles)
	deleteNote?(path: string): Promise<{ success: boolean; error?: string }>;
	executeCommand?(commandId: string): Promise<{ success: boolean; error?: string }>;
	listCommands?(): Promise<CommandInfo[]>;
	// Meta
	askUser(question: string, choices?: string[]): Promise<string>;
	onProgress(event: AgentProgressEvent): void;
}

export interface AgentInput {
	task: string;
	currentFile?: { path: string; content: string };
	vaultStats: { totalNotes: number; totalFolders: number; totalTags: number };
	chatHistory: ChatMessage[];
}

export interface AgentResult {
	success: boolean;
	summary: string;
	editsProposed: EditInstruction[];
	notesRead: string[];           // for copy-notes feature
	notesCopied: string[];         // paths of notes collected via copy_notes tool
	webSourcesUsed: WebSource[];
	tokenUsage: { total: number; promptTokens: number; completionTokens: number; perRound: number[] };
	iterationsUsed: number;
	error?: string;
}
