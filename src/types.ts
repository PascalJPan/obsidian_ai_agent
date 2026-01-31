/**
 * Shared type definitions for AI Assistant Plugin
 */

import { TFile } from 'obsidian';

// Type definitions
export type ContextScope = 'current' | 'linked' | 'folder';
export type EditableScope = 'current' | 'linked' | 'context';
export type Mode = 'qa' | 'edit';

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
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
	// Context for AI memory
	activeFile?: string;           // Path of active file when message was sent
	proposedEdits?: EditInstruction[];  // Edits the AI proposed (for assistant messages)
	editResults?: {                // Results of applying edits
		success: number;
		failed: number;
		failures: Array<{ file: string; error: string }>;
	};
}
