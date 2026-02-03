/**
 * Shared type definitions for ObsidianAgent Plugin
 */

import { TFile } from 'obsidian';

// Type definitions
export type ContextScope = 'current' | 'linked' | 'folder';  // Legacy - kept for backwards compatibility
export type EditableScope = 'current' | 'linked' | 'context';
export type Mode = 'edit' | 'agentic';

// New context scope configuration
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

// Agentic mode types
export type AgenticSubMode = 'qa' | 'edit';

export interface AgenticModeConfig {
	scoutModel: string;       // Model for Phase 1 exploration
	maxIterations: number;    // 1-10, max tool-calling rounds
	maxNotes: number;         // 3-50, max notes context agent can select
}

// Scout agent tool configuration
export interface ScoutToolConfig {
	listNotes: boolean;
	searchKeyword: boolean;
	searchSemantic: boolean;
	searchTaskRelevant: boolean;
	getLinks: boolean;
	getLinksRecursive: boolean;
	viewAllNotes: boolean;    // View all note names with frontmatter
	exploreVault: boolean;    // Explore folders and tags
	keywordLimit: number;
	semanticLimit: number;
	listNotesLimit: number;
}

// Context agent tool call types
export interface ContextAgentToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

export interface ContextAgentResult {
	selectedPaths: string[];
	reasoning: string;
	toolCalls: ContextAgentToolCall[];  // For progress display
	recommendedMode?: 'qa' | 'edit';    // Agent's recommended mode for Phase 2
}

// Progress event for live UI updates
export interface AgentProgressEvent {
	type: 'tool_call' | 'iteration' | 'complete';
	message: string;
	detail?: string;
}

// Note preview for context agent
export interface NotePreview {
	path: string;
	name: string;
	preview: string;    // First ~200 chars
}

// Semantic search result for context agent
export interface SemanticSearchResult {
	path: string;
	score: number;
	heading: string;
}

// Link info for context agent
export interface LinkInfo {
	path: string;
	direction: 'outgoing' | 'backlink';
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
	};
	// Token usage from API response (for assistant messages)
	tokenUsage?: TokenUsage;
	// Web agent results (for assistant messages in agentic mode)
	webSources?: WebSource[];
}

// ============================================
// Web Agent Types
// ============================================

export type SearchApiType = 'openai' | 'serper' | 'brave' | 'tavily';

export interface WebAgentSettings {
	enabled: boolean;              // Master toggle (default: false, opt-in)
	searchApi: SearchApiType;      // Which search API to use
	searchApiKey: string;          // API key for search service
	snippetLimit: number;          // Max search results (default: 8)
	fetchLimit: number;            // Max pages to fetch in full (default: 3)
	tokenBudget: number;           // Max tokens for web content (default: 8000)
	autoSearch: boolean;           // Automatically search when needed (default: true)
}

export interface WebSource {
	url: string;
	title: string;
	summary: string;
}

export interface WebAgentResult {
	searchPerformed: boolean;
	webContext: string;
	sources: WebSource[];
	tokensUsed: number;
	searchQuery?: string;
	skipReason?: string;
	error?: {
		message: string;
		detail: string;
	};
}

export interface WebAgentProgressEvent {
	type: 'evaluating' | 'searching' | 'fetching' | 'extracting' | 'complete' | 'skipped' | 'error';
	message: string;
	detail?: string;
}

// ============================================
// Pipeline Configuration Types
// ============================================

export interface PipelineConfig {
	scoutEnabled: boolean;         // Run Scout Agent (default: true in agentic mode)
	webEnabled: boolean;           // Run Web Agent (default: false, opt-in)
	taskEnabled: boolean;          // Run Task Agent (default: true)
}

// ============================================
// Task Agent Types
// ============================================

export interface TaskAgentConfig {
	model: string;
	apiKey: string;
	capabilities: AICapabilities;
	editableScope: EditableScope;
	customPrompts?: {
		character?: string;
		edit?: string;
	};
	chatHistoryLength: number;
	debugMode: boolean;
}

export interface TaskAgentInput {
	task: string;               // User's message (for logging)
	context: string;            // Formatted notes with line numbers (includes task section)
	chatHistory: ChatMessage[]; // Previous conversation
	webSources?: WebSource[];   // Optional web context (for citation instructions)
}

export interface TaskAgentResult {
	success: boolean;
	edits: EditInstruction[];   // Raw edits (not validated yet - validation needs vault)
	summary: string;
	tokenUsage?: TokenUsage;
	error?: string;
}
