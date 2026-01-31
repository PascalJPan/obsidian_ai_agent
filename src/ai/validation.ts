/**
 * Edit validation utilities for AI Assistant
 *
 * Pure validation and computation functions.
 * Note: Functions that depend on Obsidian vault/app remain in main.ts
 */

import { EditInstruction, ValidatedEdit } from '../types';

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Determine the edit type based on position
 */
export function determineEditType(edit: ValidatedEdit): 'replace' | 'add' | 'delete' {
	const position = edit.instruction.position;
	if (position.startsWith('delete:')) {
		return 'delete';
	}
	if (position === 'start' || position === 'end' || position.startsWith('after:') || position.startsWith('insert:')) {
		return 'add';
	}
	return 'replace';
}

/**
 * Compute new content based on edit instruction
 * Returns the resulting content and any error
 */
export function computeNewContent(currentContent: string, instruction: EditInstruction): { content: string; error: string | null } {
	const position = instruction.position;
	const newText = instruction.content;

	if (position === 'start') {
		return { content: newText + '\n\n' + currentContent, error: null };
	}

	if (position === 'end') {
		return { content: currentContent + '\n\n' + newText, error: null };
	}

	if (position.startsWith('after:')) {
		const heading = position.substring(6);
		const headingRegex = new RegExp(`^(${escapeRegex(heading)})\\s*$`, 'm');
		const match = currentContent.match(headingRegex);

		if (!match || match.index === undefined) {
			return { content: '', error: `Heading not found: "${heading}"` };
		}

		const headingEnd = match.index + match[0].length;
		const before = currentContent.substring(0, headingEnd);
		const after = currentContent.substring(headingEnd);

		return { content: before + '\n\n' + newText + after, error: null };
	}

	if (position.startsWith('insert:')) {
		const lineSpec = position.substring(7);
		const lineNum = parseInt(lineSpec, 10);

		if (isNaN(lineNum)) {
			return { content: '', error: `Invalid line number for insert: "${lineSpec}"` };
		}

		const lines = currentContent.split('\n');

		if (lineNum < 1) {
			return { content: '', error: `Line number must be at least 1, got: ${lineNum}` };
		}

		if (lineNum > lines.length + 1) {
			return { content: '', error: `Line ${lineNum} out of range (file has ${lines.length} lines, can insert up to line ${lines.length + 1})` };
		}

		const newLines = [
			...lines.slice(0, lineNum - 1),
			newText,
			...lines.slice(lineNum - 1)
		];

		return { content: newLines.join('\n'), error: null };
	}

	if (position.startsWith('delete:')) {
		const lineSpec = position.substring(7);
		const rangeMatch = lineSpec.match(/^(\d+)(?:-(\d+))?$/);

		if (!rangeMatch) {
			return { content: '', error: `Invalid delete format: "${lineSpec}". Use "delete:5" or "delete:5-7"` };
		}

		const startLine = parseInt(rangeMatch[1], 10);
		const endLine = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : startLine;

		const lines = currentContent.split('\n');

		if (startLine < 1 || startLine > lines.length) {
			return { content: '', error: `Line ${startLine} out of range (file has ${lines.length} lines)` };
		}
		if (endLine < startLine || endLine > lines.length) {
			return { content: '', error: `Line range ${startLine}-${endLine} invalid (file has ${lines.length} lines)` };
		}

		const newLines = [
			...lines.slice(0, startLine - 1),
			...lines.slice(endLine)
		];

		return { content: newLines.join('\n'), error: null };
	}

	if (position.startsWith('replace:')) {
		const lineSpec = position.substring(8);
		const rangeMatch = lineSpec.match(/^(\d+)(?:-(\d+))?$/);

		if (rangeMatch) {
			const startLine = parseInt(rangeMatch[1], 10);
			const endLine = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : startLine;

			const lines = currentContent.split('\n');

			if (startLine < 1 || startLine > lines.length) {
				return { content: '', error: `Line ${startLine} out of range (file has ${lines.length} lines)` };
			}
			if (endLine < startLine || endLine > lines.length) {
				return { content: '', error: `Line range ${startLine}-${endLine} invalid (file has ${lines.length} lines)` };
			}

			const newLines = [
				...lines.slice(0, startLine - 1),
				newText,
				...lines.slice(endLine)
			];

			return { content: newLines.join('\n'), error: null };
		}

		const normalizedContent = currentContent.replace(/\r\n/g, '\n');
		const normalizedSearch = lineSpec.replace(/\r\n/g, '\n');

		if (!normalizedContent.includes(normalizedSearch)) {
			return { content: '', error: `Text to replace not found. Use "replace:LINE_NUMBER" format (e.g., "replace:5" or "replace:5-7")` };
		}

		return { content: normalizedContent.replace(normalizedSearch, newText), error: null };
	}

	return { content: '', error: `Unknown position type: "${position}"` };
}
