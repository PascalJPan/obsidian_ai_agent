/**
 * Shared type definitions for AI Assistant Plugin
 */

import { TFile } from 'obsidian';

// Type definitions
export type ContextScope = 'current' | 'linked' | 'folder';  // Legacy - kept for backwards compatibility
export type EditableScope = 'current' | 'linked' | 'context';
export type Mode = 'qa' | 'edit';

// New context scope configuration
export type LinkDepth = 0 | 1 | 2 | 3;

export interface ContextScopeConfig {
	linkDepth: LinkDepth;           // 0=current only, 1=direct links, 2-3=deeper traversal
	maxLinkedNotes: number;         // 0-50, 0 = use all linked notes
	maxFolderNotes: number;         // 0-20, 0 = none (replaces includeSameFolder)
	semanticMatchCount: number;     // 0-20, 0 = none (replaces includeSemanticMatches)
	semanticMinSimilarity: number;  // 0-100, percentage threshold for semantic matches
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

// Context info for preview modal
export interface ContextInfo {
	currentNote: string;
	linkedNotes: string[];
	folderNotes: string[];
	semanticNotes: { path: string; score: number }[];
	totalTokenEstimate: number;
}

export interface AICapabilities {
	canAdd: boolean;
	canDelete: boolean;
	canCreate: boolean;
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
}
