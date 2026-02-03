/**
 * EditManager - Handles pending edit blocks and resolution
 *
 * This module manages the lifecycle of AI-proposed edits:
 * - Creating edit blocks (ai-edit, ai-new-note)
 * - Resolving edits (accept/reject)
 * - Batch processing edits
 * - Inserting validated edits into files
 */

import { Vault, TFile, Notice } from 'obsidian';
import { ValidatedEdit, InlineEdit } from '../types';
import { escapeRegex, determineEditType } from '../ai/validation';
import { Logger } from '../utils/logger';

/**
 * Dependencies required by EditManager
 * Using dependency injection for testability and decoupling from Obsidian Plugin class
 */
export interface EditManagerDeps {
	vault: Vault;
	getPendingEditTag: () => string;  // Getter to support dynamic settings updates
	logger: Logger;
	getActiveFile?: () => TFile | null;
	getMarkdownFiles?: () => TFile[];
}

/**
 * Result of inserting edit blocks
 */
export interface InsertEditBlocksResult {
	success: number;
	failed: number;
}

/**
 * EditManager class handles all edit-related operations
 */
export class EditManager {
	constructor(private deps: EditManagerDeps) {}

	// ============================================
	// Pure Utility Functions (no deps needed)
	// ============================================

	/**
	 * Generate a random 8-character edit ID
	 */
	generateEditId(): string {
		return Math.random().toString(36).substring(2, 10);
	}

	/**
	 * Extract InlineEdit objects from file content
	 */
	extractEditsFromContent(content: string): InlineEdit[] {
		const edits: InlineEdit[] = [];
		const regex = /```ai-edit\n([\s\S]*?)```/g;
		let match;

		while ((match = regex.exec(content)) !== null) {
			try {
				const edit = JSON.parse(match[1]);
				edits.push(edit);
			} catch (e) {
				console.error('Failed to parse edit block:', e);
			}
		}

		return edits;
	}

	/**
	 * Extract new note IDs from ai-new-note blocks
	 */
	extractNewNoteIdsFromContent(content: string): string[] {
		const ids: string[] = [];
		const regex = /```ai-new-note\n([\s\S]*?)```/g;
		let match;

		while ((match = regex.exec(content)) !== null) {
			try {
				const data = JSON.parse(match[1]);
				if (data.id) {
					ids.push(data.id);
				}
			} catch (e) {
				console.error('Failed to parse ai-new-note block:', e);
			}
		}

		return ids;
	}

	/**
	 * Get the line number for an edit (for sorting purposes)
	 */
	getEditLineNumber(edit: ValidatedEdit): number {
		const position = edit.instruction.position;

		if (position === 'start') {
			return 0; // Start goes at the very beginning
		}
		if (position === 'end') {
			return Infinity; // End goes at the very end
		}
		if (position.startsWith('insert:')) {
			return parseInt(position.substring(7), 10) || 0;
		}
		if (position.startsWith('replace:') || position.startsWith('delete:')) {
			const lineSpec = position.split(':')[1];
			const rangeMatch = lineSpec.match(/^(\d+)(?:-(\d+))?$/);
			if (rangeMatch) {
				return parseInt(rangeMatch[1], 10);
			}
		}
		if (position.startsWith('after:')) {
			// For headings, we need to find the line number in the content
			// Return a high number since we can't easily determine without content
			return Infinity - 1;
		}
		return 0;
	}

	/**
	 * Sort edits by line number descending (bottom-to-top processing)
	 */
	sortEditsByLineDescending(edits: ValidatedEdit[]): ValidatedEdit[] {
		return [...edits].sort((a, b) => {
			const lineA = this.getEditLineNumber(a);
			const lineB = this.getEditLineNumber(b);
			return lineB - lineA; // Descending order
		});
	}

	/**
	 * Extract the "after" content from an edit
	 */
	extractAfterContent(edit: ValidatedEdit): string {
		return edit.instruction.content;
	}

	// ============================================
	// Methods using deps.pendingEditTag
	// ============================================

	/**
	 * Create an edit block string for insertion into a file
	 */
	createEditBlock(edit: InlineEdit): string {
		return '```ai-edit\n' + JSON.stringify(edit) + '\n```\n' + this.deps.getPendingEditTag();
	}

	/**
	 * Create a new note block string for insertion at the top of a new file
	 */
	createNewNoteBlock(id: string): string {
		return '```ai-new-note\n' + JSON.stringify({ id }) + '\n```\n' + this.deps.getPendingEditTag();
	}

	// ============================================
	// Methods using deps.vault
	// ============================================

	/**
	 * Extract the "before" content for the edit widget display
	 * contentOverride allows using modified in-memory content during batch processing
	 */
	extractBeforeContent(edit: ValidatedEdit, contentOverride?: string): string {
		const position = edit.instruction.position;
		const content = contentOverride ?? edit.currentContent;

		if (position.startsWith('replace:') || position.startsWith('delete:')) {
			const lineSpec = position.split(':')[1];
			const rangeMatch = lineSpec.match(/^(\d+)(?:-(\d+))?$/);
			if (rangeMatch) {
				const startLine = parseInt(rangeMatch[1], 10);
				const endLine = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : startLine;
				const lines = content.split('\n');

				// Bounds checking
				const safeStart = Math.max(0, Math.min(startLine - 1, lines.length));
				const safeEnd = Math.max(safeStart, Math.min(endLine, lines.length));

				return lines.slice(safeStart, safeEnd).join('\n');
			}
		}
		return '';
	}

	/**
	 * Apply an edit block to content string in memory
	 */
	applyEditBlockToContent(content: string, validatedEdit: ValidatedEdit, inlineEdit: InlineEdit): string {
		const position = validatedEdit.instruction.position;
		const editBlock = this.createEditBlock(inlineEdit);

		if (position === 'start') {
			return editBlock + '\n\n' + content;
		}
		if (position === 'end') {
			return content + '\n\n' + editBlock;
		}
		if (position.startsWith('after:')) {
			const heading = position.substring(6);
			const headingRegex = new RegExp(`^(${escapeRegex(heading)})\\s*$`, 'm');
			const match = content.match(headingRegex);
			if (match && match.index !== undefined) {
				const headingEnd = match.index + match[0].length;
				return content.substring(0, headingEnd) + '\n\n' + editBlock + content.substring(headingEnd);
			}
		}
		if (position.startsWith('insert:')) {
			const lineNum = parseInt(position.substring(7), 10);
			const lines = content.split('\n');
			lines.splice(lineNum - 1, 0, editBlock);
			return lines.join('\n');
		}
		if (position.startsWith('replace:') || position.startsWith('delete:')) {
			const lineSpec = position.split(':')[1];
			const rangeMatch = lineSpec.match(/^(\d+)(?:-(\d+))?$/);
			if (rangeMatch) {
				const startLine = parseInt(rangeMatch[1], 10);
				const endLine = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : startLine;
				const lines = content.split('\n');
				// Replace the lines with the edit block
				lines.splice(startLine - 1, endLine - startLine + 1, editBlock);
				return lines.join('\n');
			}
		}

		return content;
	}

	/**
	 * Resolve an individual edit (accept or reject)
	 */
	async resolveEdit(filePath: string, edit: InlineEdit, action: 'accept' | 'reject'): Promise<void> {
		const file = this.deps.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			new Notice('Could not find file');
			return;
		}

		let content = await this.deps.vault.read(file);

		// Build regex patterns to find the edit block
		// Pattern 1: Exact JSON match
		const exactBlockRegex = new RegExp(
			'\\n?```ai-edit\\n' + escapeRegex(JSON.stringify(edit)) + '\\n```\\n?' +
			escapeRegex(this.deps.getPendingEditTag()) + '\\n?',
			'g'
		);

		// Pattern 2: Match by edit ID (more flexible for whitespace variations)
		const idBlockRegex = new RegExp(
			'\\n?```ai-edit\\n[^`]*?"id"\\s*:\\s*"' + escapeRegex(edit.id) + '"[^`]*?```\\n?' +
			escapeRegex(this.deps.getPendingEditTag()) + '\\n?',
			'g'
		);

		// Determine replacement content
		let replacement = '';
		if (action === 'accept') {
			replacement = edit.after || '';
		} else {
			replacement = edit.before || '';
		}

		// Add a newline after non-empty replacements
		const finalReplacement = replacement ? replacement + '\n' : '';

		// Try exact pattern first, then fallback to ID-based pattern
		const originalContent = content;
		content = content.replace(exactBlockRegex, finalReplacement);

		// If exact pattern didn't match, try ID-based pattern
		if (content === originalContent) {
			content = content.replace(idBlockRegex, finalReplacement);
		}

		// Clean up multiple consecutive newlines (more than 2) to at most 2
		content = content.replace(/\n{3,}/g, '\n\n');

		// Clean up trailing whitespace at end of file
		content = content.replace(/\n+$/, '\n');

		// Handle case where entire content was deleted
		if (content.trim() === '') {
			content = '';
		}

		await this.deps.vault.modify(file, content);
		new Notice(`Edit ${action}ed`);
	}

	/**
	 * Resolve a new note (accept = remove banner, reject = delete file)
	 */
	async resolveNewNote(filePath: string, id: string, action: 'accept' | 'reject'): Promise<void> {
		const file = this.deps.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			new Notice('Could not find file');
			return;
		}

		if (action === 'reject') {
			// Delete the entire file
			await this.deps.vault.delete(file);
			new Notice('Note deleted');
		} else {
			// Remove the banner (ai-new-note block + tag + separator)
			let content = await this.deps.vault.read(file);

			// Remove the ai-new-note block, tag, and separator
			const bannerRegex = new RegExp(
				'```ai-new-note\\n[^`]*?"id"\\s*:\\s*"' + escapeRegex(id) + '"[^`]*?```\\n?' +
				escapeRegex(this.deps.getPendingEditTag()) + '\\n*' +
				'---\\n*',
				'g'
			);

			content = content.replace(bannerRegex, '');
			await this.deps.vault.modify(file, content);
			new Notice('Note accepted');
		}
	}

	/**
	 * Insert edit blocks into files
	 * Groups edits by file and processes bottom-to-top to prevent line number misalignment
	 */
	async insertEditBlocks(validatedEdits: ValidatedEdit[]): Promise<InsertEditBlocksResult> {
		this.deps.logger.log('EDIT', 'Starting edit block insertion', {
			totalEdits: validatedEdits.length,
			validEdits: validatedEdits.filter(e => !e.error).length
		});

		let success = 0;
		let failed = 0;

		// Separate new file creations from edits to existing files
		const newFileEdits: ValidatedEdit[] = [];
		const existingFileEdits: ValidatedEdit[] = [];

		for (const edit of validatedEdits) {
			if (edit.error) {
				failed++;
				continue;
			}
			if (edit.isNewFile) {
				newFileEdits.push(edit);
			} else if (edit.resolvedFile) {
				existingFileEdits.push(edit);
			}
		}

		// Handle new file creations
		for (const edit of newFileEdits) {
			try {
				const noteId = this.generateEditId();
				const banner = this.createNewNoteBlock(noteId) + '\n\n---\n\n';
				const filePath = edit.instruction.file;

				// Ensure parent folders exist
				const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
				if (folderPath) {
					const existingFolder = this.deps.vault.getAbstractFileByPath(folderPath);
					if (!existingFolder) {
						await this.deps.vault.createFolder(folderPath);
					}
				}

				await this.deps.vault.create(filePath, banner + edit.newContent);
				success++;
			} catch (e) {
				console.error('Failed to create new file:', e);
				failed++;
			}
		}

		// Group existing file edits by file path
		const editsByFile = new Map<string, ValidatedEdit[]>();
		for (const edit of existingFileEdits) {
			const path = edit.resolvedFile!.path;
			if (!editsByFile.has(path)) {
				editsByFile.set(path, []);
			}
			editsByFile.get(path)!.push(edit);
		}

		// Process each file's edits
		for (const [filePath, edits] of editsByFile) {
			try {
				const file = this.deps.vault.getAbstractFileByPath(filePath);
				if (!(file instanceof TFile)) continue;

				// Read file content once
				let content = await this.deps.vault.read(file);

				// Sort edits by line number descending (bottom-to-top)
				const sortedEdits = this.sortEditsByLineDescending(edits);

				// Apply each edit to the content in memory
				for (const edit of sortedEdits) {
					const inlineEdit: InlineEdit = {
						id: this.generateEditId(),
						type: determineEditType(edit),
						before: this.extractBeforeContent(edit, content),
						after: edit.newContent !== edit.currentContent ? this.extractAfterContent(edit) : ''
					};

					content = this.applyEditBlockToContent(content, edit, inlineEdit);
					success++;
				}

				// Write the file once with all edits applied
				await this.deps.vault.modify(file, content);
			} catch (e) {
				this.deps.logger.error('EDIT', `Failed to insert edit blocks for file: ${filePath}`, e);
				failed += edits.length;
			}
		}

		this.deps.logger.log('EDIT', 'Edit block insertion completed', {
			success,
			failed,
			filesModified: editsByFile.size,
			newFilesCreated: newFileEdits.length
		});

		return { success, failed };
	}

	/**
	 * Process next pending edit in current file (for keyboard shortcuts)
	 */
	async processNextEdit(action: 'accept' | 'reject'): Promise<void> {
		if (!this.deps.getActiveFile) {
			new Notice('getActiveFile not available');
			return;
		}

		const file = this.deps.getActiveFile();
		if (!file) {
			new Notice('No active file');
			return;
		}

		const content = await this.deps.vault.read(file);
		const edits = this.extractEditsFromContent(content);

		if (edits.length === 0) {
			new Notice('No pending edits in current note');
			return;
		}

		// Process the first edit
		await this.resolveEdit(file.path, edits[0], action);
	}

	/**
	 * Batch process all pending edits (including new file banners)
	 */
	async batchProcessEdits(action: 'accept' | 'reject'): Promise<void> {
		if (!this.deps.getMarkdownFiles) {
			new Notice('getMarkdownFiles not available');
			return;
		}

		const files = this.deps.getMarkdownFiles();
		let totalProcessed = 0;

		for (const file of files) {
			const content = await this.deps.vault.read(file);

			// Process ai-edit blocks
			if (content.includes('```ai-edit')) {
				const edits = this.extractEditsFromContent(content);
				for (const edit of edits) {
					await this.resolveEdit(file.path, edit, action);
					totalProcessed++;
				}
			}

			// Process ai-new-note blocks (new file banners)
			if (content.includes('```ai-new-note')) {
				const newNoteIds = this.extractNewNoteIdsFromContent(content);
				for (const id of newNoteIds) {
					await this.resolveNewNote(file.path, id, action);
					totalProcessed++;
				}
			}
		}

		new Notice(`${action === 'accept' ? 'Accepted' : 'Rejected'} ${totalProcessed} pending edit(s)`);
	}
}
