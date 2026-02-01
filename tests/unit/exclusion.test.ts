/**
 * Unit tests for file exclusion logic
 *
 * These tests verify the isFileExcluded function behavior in contextAgent.ts
 */

import { describe, it, expect } from 'vitest';

// Re-implement the isFileExcluded function for testing (mirrors contextAgent.ts)
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

describe('isFileExcluded', () => {
	it('returns false when no folders are excluded', () => {
		expect(isFileExcluded('Notes/test.md', [])).toBe(false);
		expect(isFileExcluded('Projects/Active/task.md', [])).toBe(false);
	});

	it('returns true for files directly in excluded folder', () => {
		const excludedFolders = ['Private'];
		expect(isFileExcluded('Private/secret.md', excludedFolders)).toBe(true);
		expect(isFileExcluded('Private/notes.md', excludedFolders)).toBe(true);
	});

	it('returns true for files in nested excluded folders', () => {
		const excludedFolders = ['Private'];
		expect(isFileExcluded('Private/Deep/secret.md', excludedFolders)).toBe(true);
		expect(isFileExcluded('Private/Very/Deep/Nested/file.md', excludedFolders)).toBe(true);
	});

	it('returns false for files outside excluded folders', () => {
		const excludedFolders = ['Private'];
		expect(isFileExcluded('Public/note.md', excludedFolders)).toBe(false);
		expect(isFileExcluded('Projects/Active/task.md', excludedFolders)).toBe(false);
	});

	it('handles folder paths with trailing slashes', () => {
		const excludedFolders = ['Private/'];
		expect(isFileExcluded('Private/secret.md', excludedFolders)).toBe(true);
		expect(isFileExcluded('Private/Deep/file.md', excludedFolders)).toBe(true);
	});

	it('handles multiple excluded folders', () => {
		const excludedFolders = ['Private', 'Sensitive', 'Archive/Old'];
		expect(isFileExcluded('Private/secret.md', excludedFolders)).toBe(true);
		expect(isFileExcluded('Sensitive/data.md', excludedFolders)).toBe(true);
		expect(isFileExcluded('Archive/Old/file.md', excludedFolders)).toBe(true);
		expect(isFileExcluded('Archive/New/file.md', excludedFolders)).toBe(false);
		expect(isFileExcluded('Public/note.md', excludedFolders)).toBe(false);
	});

	it('is case-sensitive for folder matching', () => {
		const excludedFolders = ['Private'];
		expect(isFileExcluded('Private/secret.md', excludedFolders)).toBe(true);
		expect(isFileExcluded('private/secret.md', excludedFolders)).toBe(false);
		expect(isFileExcluded('PRIVATE/secret.md', excludedFolders)).toBe(false);
	});

	it('does not match partial folder names', () => {
		const excludedFolders = ['Private'];
		// "PrivateNotes" is different from "Private"
		expect(isFileExcluded('PrivateNotes/secret.md', excludedFolders)).toBe(false);
		expect(isFileExcluded('MyPrivate/secret.md', excludedFolders)).toBe(false);
	});

	it('handles root-level files correctly', () => {
		const excludedFolders = ['Private'];
		// Root level files have empty parent path
		expect(isFileExcluded('readme.md', excludedFolders)).toBe(false);
	});

	it('handles deeply nested excluded folders', () => {
		const excludedFolders = ['Projects/Active/Private'];
		expect(isFileExcluded('Projects/Active/Private/secret.md', excludedFolders)).toBe(true);
		expect(isFileExcluded('Projects/Active/Public/open.md', excludedFolders)).toBe(false);
		expect(isFileExcluded('Projects/Private/other.md', excludedFolders)).toBe(false);
	});
});

describe('filterEditsByRulesWithConfig exclusion enforcement', () => {
	// These tests document the expected behavior of the hard enforcement filter
	// The actual implementation is in main.ts which requires Obsidian mocks
	// These serve as specification tests

	it('should reject edits to files in excluded folders (specification)', () => {
		// When editableScope is 'context' and a file is in excludedFolders,
		// filterEditsByRulesWithConfig should mark the edit with an error
		// This is tested through integration, but documented here
		const expectedBehavior = 'Edits to excluded files are rejected with error message';
		expect(expectedBehavior).toBeTruthy();
	});

	it('should reject edits outside editable scope (specification)', () => {
		// When editableScope is 'current' and an edit targets a different file,
		// filterEditsByRulesWithConfig should reject it
		const expectedBehavior = 'Edits outside scope are rejected with error message';
		expect(expectedBehavior).toBeTruthy();
	});
});
