/**
 * Unit tests for src/ai/validation.ts
 */

import { describe, it, expect } from 'vitest';
import { escapeRegex, determineEditType, computeNewContent } from '../../src/ai/validation';
import { ValidatedEdit, EditInstruction } from '../../src/types';

describe('escapeRegex', () => {
	it('escapes special regex characters', () => {
		expect(escapeRegex('hello.world')).toBe('hello\\.world');
		expect(escapeRegex('foo*bar')).toBe('foo\\*bar');
		expect(escapeRegex('[test]')).toBe('\\[test\\]');
		expect(escapeRegex('a+b?c')).toBe('a\\+b\\?c');
		expect(escapeRegex('$100')).toBe('\\$100');
		expect(escapeRegex('a^b')).toBe('a\\^b');
		expect(escapeRegex('a|b')).toBe('a\\|b');
		expect(escapeRegex('path\\to\\file')).toBe('path\\\\to\\\\file');
	});

	it('leaves normal strings unchanged', () => {
		expect(escapeRegex('hello world')).toBe('hello world');
		expect(escapeRegex('abc123')).toBe('abc123');
	});

	it('handles empty string', () => {
		expect(escapeRegex('')).toBe('');
	});
});

describe('determineEditType', () => {
	const createValidatedEdit = (position: string): ValidatedEdit => ({
		instruction: { file: 'test.md', position, content: 'content' },
		resolvedFile: null,
		currentContent: '',
		newContent: '',
		error: null
	});

	it('returns "delete" for delete positions', () => {
		expect(determineEditType(createValidatedEdit('delete:5'))).toBe('delete');
		expect(determineEditType(createValidatedEdit('delete:5-10'))).toBe('delete');
	});

	it('returns "add" for insertion positions', () => {
		expect(determineEditType(createValidatedEdit('start'))).toBe('add');
		expect(determineEditType(createValidatedEdit('end'))).toBe('add');
		expect(determineEditType(createValidatedEdit('after:## Heading'))).toBe('add');
		expect(determineEditType(createValidatedEdit('insert:5'))).toBe('add');
	});

	it('returns "replace" for other positions', () => {
		expect(determineEditType(createValidatedEdit('replace:5'))).toBe('replace');
		expect(determineEditType(createValidatedEdit('replace:5-10'))).toBe('replace');
	});
});

describe('computeNewContent', () => {
	const sampleContent = `Line 1
Line 2
Line 3
## Heading
Line under heading
Line 6`;

	describe('position: start', () => {
		it('inserts content at the beginning', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'start',
				content: 'New start'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBeNull();
			expect(result.content).toBe('New start\n\n' + sampleContent);
		});

		it('works with empty original content', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'start',
				content: 'First content'
			};
			const result = computeNewContent('', instruction);
			expect(result.error).toBeNull();
			expect(result.content).toBe('First content\n\n');
		});
	});

	describe('position: end', () => {
		it('appends content at the end', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'end',
				content: 'New end'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBeNull();
			expect(result.content).toBe(sampleContent + '\n\nNew end');
		});
	});

	describe('position: after:heading', () => {
		it('inserts content after a heading', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'after:## Heading',
				content: 'After heading content'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBeNull();
			expect(result.content).toContain('## Heading\n\nAfter heading content');
		});

		it('returns error for non-existent heading', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'after:## NonExistent',
				content: 'Content'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBe('Heading not found: "## NonExistent"');
		});
	});

	describe('position: insert:N', () => {
		it('inserts content before specified line', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'insert:2',
				content: 'Inserted line'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBeNull();
			const lines = result.content.split('\n');
			expect(lines[0]).toBe('Line 1');
			expect(lines[1]).toBe('Inserted line');
			expect(lines[2]).toBe('Line 2');
		});

		it('allows inserting at line 1', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'insert:1',
				content: 'First line'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBeNull();
			expect(result.content.startsWith('First line')).toBe(true);
		});

		it('returns error for line 0', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'insert:0',
				content: 'Content'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBe('Line number must be at least 1, got: 0');
		});

		it('returns error for out of range line', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'insert:100',
				content: 'Content'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toContain('out of range');
		});

		it('returns error for invalid line number', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'insert:abc',
				content: 'Content'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toContain('Invalid line number');
		});
	});

	describe('position: replace:N', () => {
		it('replaces a single line', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'replace:2',
				content: 'Replaced line 2'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBeNull();
			const lines = result.content.split('\n');
			expect(lines[0]).toBe('Line 1');
			expect(lines[1]).toBe('Replaced line 2');
			expect(lines[2]).toBe('Line 3');
		});

		it('returns error for out of range line', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'replace:100',
				content: 'Content'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toContain('out of range');
		});
	});

	describe('position: replace:N-M', () => {
		it('replaces a range of lines', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'replace:2-4',
				content: 'Replaced lines 2-4'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBeNull();
			const lines = result.content.split('\n');
			expect(lines[0]).toBe('Line 1');
			expect(lines[1]).toBe('Replaced lines 2-4');
			expect(lines[2]).toBe('Line under heading');
		});

		it('returns error when end < start', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'replace:5-2',
				content: 'Content'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toContain('invalid');
		});

		it('returns error for out of range end line', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'replace:2-100',
				content: 'Content'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toContain('invalid');
		});
	});

	describe('position: delete:N', () => {
		it('deletes a single line', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'delete:2',
				content: ''
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBeNull();
			const lines = result.content.split('\n');
			expect(lines[0]).toBe('Line 1');
			expect(lines[1]).toBe('Line 3');
		});

		it('returns error for out of range line', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'delete:100',
				content: ''
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toContain('out of range');
		});
	});

	describe('position: delete:N-M', () => {
		it('deletes a range of lines', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'delete:2-4',
				content: ''
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBeNull();
			const lines = result.content.split('\n');
			expect(lines[0]).toBe('Line 1');
			expect(lines[1]).toBe('Line under heading');
		});

		it('returns error for invalid format', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'delete:abc',
				content: ''
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toContain('Invalid delete format');
		});
	});

	describe('unknown position', () => {
		it('returns error for unknown position type', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'unknown:123',
				content: 'Content'
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBe('Unknown position type: "unknown:123"');
		});
	});

	describe('edge cases', () => {
		it('handles content with CRLF line endings', () => {
			const crlfContent = 'Line 1\r\nLine 2\r\nLine 3';
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'replace:2',
				content: 'New Line 2'
			};
			const result = computeNewContent(crlfContent, instruction);
			expect(result.error).toBeNull();
		});

		it('handles empty content for start position', () => {
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'start',
				content: ''
			};
			const result = computeNewContent(sampleContent, instruction);
			expect(result.error).toBeNull();
		});

		it('handles single-line file', () => {
			const singleLine = 'Only line';
			const instruction: EditInstruction = {
				file: 'test.md',
				position: 'replace:1',
				content: 'Replaced'
			};
			const result = computeNewContent(singleLine, instruction);
			expect(result.error).toBeNull();
			expect(result.content).toBe('Replaced');
		});
	});
});
