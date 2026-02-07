/**
 * Modal components for ObsidianAgent Plugin
 *
 * This module contains modal dialogs used throughout the plugin:
 * - TokenWarningModal: Warns about high token counts
 * - PendingEditsModal: Shows pending edits across files
 * - ContextPreviewModal: Previews context notes before sending
 * - NotePickerModal: Fuzzy picker for adding notes to context
 * - EditPreviewModal: Preview and select edits before applying
 */

import { App, Modal, Notice, TFile, FuzzySuggestModal, setIcon } from 'obsidian';
import { ContextInfo, NoteFrontmatter, ValidatedEdit } from '../types';
import { computeDiff } from '../edits/diff';

/**
 * Modal for warning about high token counts
 */
export class TokenWarningModal extends Modal {
	estimatedTokens: number;
	threshold: number;
	onResult: (confirmed: boolean) => void;

	constructor(app: App, estimatedTokens: number, threshold: number, onResult: (confirmed: boolean) => void) {
		super(app);
		this.estimatedTokens = estimatedTokens;
		this.threshold = threshold;
		this.onResult = onResult;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('token-warning-modal');

		contentEl.createEl('h2', { text: 'Token Warning' });

		const warningIcon = contentEl.createDiv({ cls: 'token-warning-icon' });
		warningIcon.setText('\u26A0\uFE0F');

		contentEl.createEl('p', {
			text: `Estimated token count (~${this.estimatedTokens.toLocaleString()}) exceeds your warning threshold (${this.threshold.toLocaleString()}).`
		});

		contentEl.createEl('p', {
			text: 'Large context sizes may increase API costs and response time.',
			cls: 'token-warning-note'
		});

		const buttonRow = contentEl.createDiv({ cls: 'token-warning-buttons' });

		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => {
			this.onResult(false);
			this.close();
		});

		const proceedBtn = buttonRow.createEl('button', { text: 'Proceed Anyway', cls: 'mod-warning' });
		proceedBtn.addEventListener('click', () => {
			this.onResult(true);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Modal for showing pending edits list
 */
export class PendingEditsModal extends Modal {
	filesWithEdits: { file: TFile; count: number }[];

	constructor(app: App, filesWithEdits: { file: TFile; count: number }[]) {
		super(app);
		this.filesWithEdits = filesWithEdits;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('pending-edits-modal');

		contentEl.createEl('h2', { text: 'Pending Edits' });

		const total = this.filesWithEdits.reduce((sum, f) => sum + f.count, 0);
		contentEl.createEl('p', {
			text: `${total} pending edit(s) in ${this.filesWithEdits.length} file(s)`
		});

		const list = contentEl.createDiv({ cls: 'pending-edits-list' });

		for (const { file, count } of this.filesWithEdits) {
			const item = list.createDiv({ cls: 'pending-edits-item' });
			const link = item.createEl('a', { text: file.basename });
			link.addEventListener('click', async () => {
				await this.app.workspace.openLinkText(file.path, '', false);
				this.close();
			});
			item.createSpan({ text: ` (${count} edit${count !== 1 ? 's' : ''})`, cls: 'pending-edits-count' });
		}

		const buttonRow = contentEl.createDiv({ cls: 'pending-edits-buttons' });
		const closeBtn = buttonRow.createEl('button', { text: 'Close' });
		closeBtn.addEventListener('click', () => this.close());
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Modal for previewing context notes
 */
export class ContextPreviewModal extends Modal {
	contextInfo: ContextInfo;

	constructor(app: App, contextInfo: ContextInfo) {
		super(app);
		this.contextInfo = contextInfo;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('context-preview-modal');

		const totalNotes = 1 + this.contextInfo.linkedNotes.length +
			this.contextInfo.folderNotes.length + this.contextInfo.semanticNotes.length +
			this.contextInfo.manualNotes.length;

		contentEl.createEl('p', {
			text: `${totalNotes} note${totalNotes !== 1 ? 's' : ''} · ~${this.contextInfo.totalTokenEstimate.toLocaleString()} tokens`,
			cls: 'context-preview-summary'
		});

		const list = contentEl.createDiv({ cls: 'context-preview-list' });

		// Current note
		this.renderGroup(list, 'Current Note', 'file-text', [this.contextInfo.currentNote]);

		// Linked notes
		if (this.contextInfo.linkedNotes.length > 0) {
			this.renderGroup(list, `Linked Notes (${this.contextInfo.linkedNotes.length})`, 'link', this.contextInfo.linkedNotes);
		}

		// Folder notes
		if (this.contextInfo.folderNotes.length > 0) {
			this.renderGroup(list, `Same Folder (${this.contextInfo.folderNotes.length})`, 'folder', this.contextInfo.folderNotes);
		}

		// Semantic notes
		if (this.contextInfo.semanticNotes.length > 0) {
			this.renderSemanticGroup(list);
		}

		// Manually added notes
		if (this.contextInfo.manualNotes.length > 0) {
			this.renderGroup(list, `Manually Added (${this.contextInfo.manualNotes.length})`, 'plus-circle', this.contextInfo.manualNotes);
		}

		const buttonRow = contentEl.createDiv({ cls: 'context-preview-buttons' });
		const closeBtn = buttonRow.createEl('button', { text: 'Close' });
		closeBtn.addEventListener('click', () => this.close());
	}

	renderGroup(container: HTMLElement, title: string, icon: string, paths: string[]) {
		const group = container.createDiv({ cls: 'context-preview-group' });

		const header = group.createDiv({ cls: 'context-preview-group-header' });
		setIcon(header.createSpan({ cls: 'context-preview-icon' }), icon);
		header.createSpan({ text: title, cls: 'context-preview-group-title' });

		const items = group.createDiv({ cls: 'context-preview-group-items' });
		for (const path of paths) {
			const item = items.createDiv({ cls: 'context-preview-item' });
			const name = path.split('/').pop()?.replace('.md', '') || path;
			const link = item.createEl('a', { text: name });
			link.addEventListener('click', async () => {
				await this.app.workspace.openLinkText(path, '', false);
				this.close();
			});

			// Add frontmatter metadata if available
			if (this.contextInfo.frontmatter) {
				const fm = this.contextInfo.frontmatter.get(path);
				if (fm) {
					// Show aliases
					if (fm.aliases && fm.aliases.length > 0) {
						const aliasSpan = item.createSpan({ cls: 'context-preview-aliases' });
						aliasSpan.setText(`(${fm.aliases.slice(0, 2).join(', ')}${fm.aliases.length > 2 ? '...' : ''})`);
					}
					// Show description
					if (fm.description) {
						const descEl = item.createDiv({ cls: 'context-preview-description' });
						const truncated = fm.description.length > 60 ? fm.description.substring(0, 60) + '...' : fm.description;
						descEl.setText(truncated);
					}
				}
			}
		}
	}

	renderSemanticGroup(container: HTMLElement) {
		const group = container.createDiv({ cls: 'context-preview-group' });

		const header = group.createDiv({ cls: 'context-preview-group-header' });
		setIcon(header.createSpan({ cls: 'context-preview-icon' }), 'search');
		header.createSpan({ text: `Semantic Matches (${this.contextInfo.semanticNotes.length})`, cls: 'context-preview-group-title' });

		const items = group.createDiv({ cls: 'context-preview-group-items' });
		for (const { path, score } of this.contextInfo.semanticNotes) {
			const item = items.createDiv({ cls: 'context-preview-item' });
			const name = path.split('/').pop()?.replace('.md', '') || path;
			const link = item.createEl('a', { text: name });
			link.addEventListener('click', async () => {
				await this.app.workspace.openLinkText(path, '', false);
				this.close();
			});
			item.createSpan({ text: ` (${(score * 100).toFixed(0)}%)`, cls: 'context-preview-score' });

			// Add frontmatter metadata if available
			if (this.contextInfo.frontmatter) {
				const fm = this.contextInfo.frontmatter.get(path);
				if (fm) {
					// Show aliases
					if (fm.aliases && fm.aliases.length > 0) {
						const aliasSpan = item.createSpan({ cls: 'context-preview-aliases' });
						aliasSpan.setText(`(${fm.aliases.slice(0, 2).join(', ')}${fm.aliases.length > 2 ? '...' : ''})`);
					}
					// Show description
					if (fm.description) {
						const descEl = item.createDiv({ cls: 'context-preview-description' });
						const truncated = fm.description.length > 60 ? fm.description.substring(0, 60) + '...' : fm.description;
						descEl.setText(truncated);
					}
				}
			}
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Interface for plugin methods needed by NotePickerModal
 */
export interface NotePickerPlugin {
	isFileExcluded(file: TFile): boolean;
}

/**
 * Note Picker Modal for manually adding notes to context
 */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
	plugin: NotePickerPlugin;
	onSelectNote: (file: TFile) => void;

	constructor(app: App, plugin: NotePickerPlugin, onSelectNote: (file: TFile) => void) {
		super(app);
		this.plugin = plugin;
		this.onSelectNote = onSelectNote;
		this.setPlaceholder('Select a note to add to context...');
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles().filter(f => !this.plugin.isFileExcluded(f));
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile, evt: MouseEvent | KeyboardEvent): void {
		this.onSelectNote(item);
	}
}

/**
 * Interface for plugin methods needed by EditPreviewModal
 */
export interface EditPreviewPlugin {
	insertEditBlocks(edits: ValidatedEdit[]): Promise<{ success: number; failed: number }>;
}

/**
 * Edit Preview Modal for previewing and selecting edits before applying
 */
export class EditPreviewModal extends Modal {
	plugin: EditPreviewPlugin;
	validatedEdits: ValidatedEdit[];
	summary: string;
	selectedEdits: Set<number>;
	isApplying = false;

	private checkboxes: HTMLInputElement[] = [];
	private applyButton: HTMLButtonElement | null = null;

	constructor(app: App, plugin: EditPreviewPlugin, validatedEdits: ValidatedEdit[], summary: string) {
		super(app);
		this.plugin = plugin;
		this.validatedEdits = validatedEdits;
		this.summary = summary;
		this.selectedEdits = new Set();

		validatedEdits.forEach((edit, index) => {
			if (!edit.error) {
				this.selectedEdits.add(index);
			}
		});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('edit-preview-modal');

		contentEl.createEl('h2', { text: 'Proposed Edits' });

		const summaryEl = contentEl.createDiv({ cls: 'edit-preview-summary' });
		summaryEl.createEl('strong', { text: 'AI Summary: ' });
		summaryEl.createSpan({ text: this.summary });

		const validCount = this.validatedEdits.filter(e => !e.error).length;
		const invalidCount = this.validatedEdits.length - validCount;
		const countInfo = contentEl.createDiv({ cls: 'edit-preview-count' });
		countInfo.setText(`${validCount} valid edit(s), ${invalidCount} with errors`);

		const editsList = contentEl.createDiv({ cls: 'edit-preview-list' });

		this.validatedEdits.forEach((edit, index) => {
			const editItem = editsList.createDiv({ cls: 'edit-preview-item' });

			if (edit.error) {
				editItem.addClass('edit-preview-error');
			}

			const headerRow = editItem.createDiv({ cls: 'edit-preview-header' });

			const checkbox = headerRow.createEl('input', { type: 'checkbox' });
			checkbox.checked = this.selectedEdits.has(index);
			checkbox.disabled = !!edit.error;
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.selectedEdits.add(index);
				} else {
					this.selectedEdits.delete(index);
				}
				this.updateApplyButtonText();
			});
			this.checkboxes.push(checkbox);

			const fileName = headerRow.createSpan({ cls: 'edit-preview-filename' });
			fileName.setText(edit.instruction.file);

			const positionSpan = headerRow.createSpan({ cls: 'edit-preview-position' });
			positionSpan.setText(`[${edit.instruction.position}]`);

			if (edit.isNewFile) {
				const newBadge = headerRow.createSpan({ cls: 'edit-preview-new-badge' });
				newBadge.setText('NEW');
			}

			if (edit.error) {
				const errorEl = editItem.createDiv({ cls: 'edit-preview-error-msg' });
				errorEl.setText(`Error: ${edit.error}`);
			}

			if (!edit.error && !edit.isNewFile && edit.currentContent !== edit.newContent) {
				const diffContainer = editItem.createDiv({ cls: 'edit-preview-diff' });
				this.renderDiff(diffContainer, edit.currentContent, edit.newContent);
			} else if (edit.isNewFile) {
				const contentPreview = editItem.createDiv({ cls: 'edit-preview-content' });
				const previewText = edit.newContent.length > 500
					? edit.newContent.substring(0, 500) + '...'
					: edit.newContent;
				contentPreview.createEl('pre', { text: previewText, cls: 'diff-added-block' });
			}
		});

		const buttonRow = contentEl.createDiv({ cls: 'edit-preview-buttons' });

		const cancelButton = buttonRow.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => this.close());

		this.applyButton = buttonRow.createEl('button', {
			text: `Apply ${this.selectedEdits.size} Edit(s)`,
			cls: 'mod-cta'
		});
		this.applyButton.addEventListener('click', async () => {
			await this.applySelectedEdits();
		});
	}

	renderDiff(container: HTMLDivElement, oldContent: string, newContent: string) {
		const diff = computeDiff(oldContent, newContent);
		const maxLines = 20;

		let displayedLines = 0;

		for (const line of diff) {
			if (displayedLines >= maxLines) break;

			const lineEl = container.createDiv({ cls: 'diff-line' });
			const lineNumEl = lineEl.createSpan({ cls: 'diff-line-number' });

			if (line.type === 'removed') {
				lineNumEl.setText(line.lineNumber?.toString() || '');
				lineEl.addClass('diff-removed');
			} else if (line.type === 'added') {
				lineNumEl.setText(line.newLineNumber?.toString() || '');
				lineEl.addClass('diff-added');
			} else {
				lineNumEl.setText(line.lineNumber?.toString() || '');
				lineEl.addClass('diff-unchanged');
			}

			const contentEl = lineEl.createSpan({ cls: 'diff-line-content' });
			const prefix = line.type === 'removed' ? '- ' : line.type === 'added' ? '+ ' : '  ';
			contentEl.setText(prefix + line.content);

			displayedLines++;
		}

		if (diff.length > maxLines) {
			const moreEl = container.createDiv({ cls: 'diff-more' });
			moreEl.setText(`...and ${diff.length - maxLines} more lines`);
		}
	}

	updateApplyButtonText() {
		if (this.applyButton) {
			this.applyButton.setText(`Apply ${this.selectedEdits.size} Edit(s)`);
		}
	}

	async applySelectedEdits() {
		const editsToApply = this.validatedEdits.filter((_, index) =>
			this.selectedEdits.has(index)
		);

		if (editsToApply.length === 0) {
			new Notice('No edits selected');
			return;
		}

		const result = await this.plugin.insertEditBlocks(editsToApply);
		new Notice(`Inserted ${result.success} pending edit(s)`);
		this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
