/**
 * Unit tests for src/ai/context.ts
 */

import { describe, it, expect } from 'vitest';
import { addLineNumbers } from '../../src/ai/context';

describe('addLineNumbers', () => {
	it('adds line numbers starting at 1', () => {
		const content = 'Line A\nLine B\nLine C';
		const result = addLineNumbers(content);
		expect(result).toBe('1: Line A\n2: Line B\n3: Line C');
	});

	it('handles single line content', () => {
		const content = 'Only line';
		const result = addLineNumbers(content);
		expect(result).toBe('1: Only line');
	});

	it('handles empty content', () => {
		const content = '';
		const result = addLineNumbers(content);
		expect(result).toBe('1: ');
	});

	it('handles content with empty lines', () => {
		const content = 'First\n\nThird';
		const result = addLineNumbers(content);
		expect(result).toBe('1: First\n2: \n3: Third');
	});

	it('preserves whitespace within lines', () => {
		const content = '  indented\n\ttabbed';
		const result = addLineNumbers(content);
		expect(result).toBe('1:   indented\n2: \ttabbed');
	});

	it('handles many lines', () => {
		const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
		const content = lines.join('\n');
		const result = addLineNumbers(content);

		const resultLines = result.split('\n');
		expect(resultLines.length).toBe(100);
		expect(resultLines[0]).toBe('1: Line 1');
		expect(resultLines[99]).toBe('100: Line 100');
	});

	it('handles content with special characters', () => {
		const content = '# Heading\n**bold** text\n`code block`';
		const result = addLineNumbers(content);
		expect(result).toBe('1: # Heading\n2: **bold** text\n3: `code block`');
	});
});
