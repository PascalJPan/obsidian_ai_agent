/**
 * Unit tests for src/edits/diff.ts
 */

import { describe, it, expect } from 'vitest';
import { computeDiff, longestCommonSubsequence } from '../../src/edits/diff';

describe('longestCommonSubsequence', () => {
	it('finds LCS of identical arrays', () => {
		const arr = ['a', 'b', 'c'];
		expect(longestCommonSubsequence(arr, arr)).toEqual(['a', 'b', 'c']);
	});

	it('finds LCS with some common elements', () => {
		const a = ['a', 'b', 'c', 'd'];
		const b = ['a', 'x', 'c', 'y'];
		expect(longestCommonSubsequence(a, b)).toEqual(['a', 'c']);
	});

	it('returns empty array when no common elements', () => {
		const a = ['a', 'b', 'c'];
		const b = ['x', 'y', 'z'];
		expect(longestCommonSubsequence(a, b)).toEqual([]);
	});

	it('handles empty first array', () => {
		expect(longestCommonSubsequence([], ['a', 'b'])).toEqual([]);
	});

	it('handles empty second array', () => {
		expect(longestCommonSubsequence(['a', 'b'], [])).toEqual([]);
	});

	it('handles both empty arrays', () => {
		expect(longestCommonSubsequence([], [])).toEqual([]);
	});

	it('handles single element arrays', () => {
		expect(longestCommonSubsequence(['a'], ['a'])).toEqual(['a']);
		expect(longestCommonSubsequence(['a'], ['b'])).toEqual([]);
	});

	it('handles longer common subsequence', () => {
		const a = ['a', 'b', 'c', 'd', 'e', 'f'];
		const b = ['a', 'x', 'b', 'c', 'y', 'e', 'z'];
		const lcs = longestCommonSubsequence(a, b);
		expect(lcs).toEqual(['a', 'b', 'c', 'e']);
	});
});

describe('computeDiff', () => {
	it('detects no changes for identical content', () => {
		const content = 'Line 1\nLine 2\nLine 3';
		const diff = computeDiff(content, content);
		expect(diff.every(d => d.type === 'unchanged')).toBe(true);
		expect(diff.length).toBe(3);
	});

	it('detects added lines', () => {
		const oldContent = 'Line 1\nLine 3';
		const newContent = 'Line 1\nLine 2\nLine 3';
		const diff = computeDiff(oldContent, newContent);

		const addedLines = diff.filter(d => d.type === 'added');
		expect(addedLines.length).toBe(1);
		expect(addedLines[0].content).toBe('Line 2');
	});

	it('detects removed lines', () => {
		const oldContent = 'Line 1\nLine 2\nLine 3';
		const newContent = 'Line 1\nLine 3';
		const diff = computeDiff(oldContent, newContent);

		const removedLines = diff.filter(d => d.type === 'removed');
		expect(removedLines.length).toBe(1);
		expect(removedLines[0].content).toBe('Line 2');
	});

	it('detects modified lines as remove+add', () => {
		const oldContent = 'Line 1\nOld line\nLine 3';
		const newContent = 'Line 1\nNew line\nLine 3';
		const diff = computeDiff(oldContent, newContent);

		const removedLines = diff.filter(d => d.type === 'removed');
		const addedLines = diff.filter(d => d.type === 'added');

		expect(removedLines.length).toBe(1);
		expect(removedLines[0].content).toBe('Old line');
		expect(addedLines.length).toBe(1);
		expect(addedLines[0].content).toBe('New line');
	});

	it('handles empty old content', () => {
		const oldContent = '';
		const newContent = 'Line 1\nLine 2';
		const diff = computeDiff(oldContent, newContent);

		// Empty string splits to one empty line, so we get one remove + two adds
		const addedLines = diff.filter(d => d.type === 'added');
		expect(addedLines.length).toBe(2);
	});

	it('handles empty new content', () => {
		const oldContent = 'Line 1\nLine 2';
		const newContent = '';
		const diff = computeDiff(oldContent, newContent);

		const removedLines = diff.filter(d => d.type === 'removed');
		expect(removedLines.length).toBe(2);
	});

	it('includes line numbers in diff', () => {
		const oldContent = 'A\nB\nC';
		const newContent = 'A\nX\nC';
		const diff = computeDiff(oldContent, newContent);

		const unchangedA = diff.find(d => d.content === 'A' && d.type === 'unchanged');
		expect(unchangedA?.lineNumber).toBe(1);
		expect(unchangedA?.newLineNumber).toBe(1);

		const removed = diff.find(d => d.type === 'removed');
		expect(removed?.lineNumber).toBe(2);

		const added = diff.find(d => d.type === 'added');
		expect(added?.newLineNumber).toBe(2);
	});

	it('handles multiple changes across the file', () => {
		const oldContent = 'Header\nOld 1\nMiddle\nOld 2\nFooter';
		const newContent = 'Header\nNew 1\nMiddle\nNew 2\nNew 3\nFooter';
		const diff = computeDiff(oldContent, newContent);

		const unchangedCount = diff.filter(d => d.type === 'unchanged').length;
		const removedCount = diff.filter(d => d.type === 'removed').length;
		const addedCount = diff.filter(d => d.type === 'added').length;

		expect(unchangedCount).toBe(3); // Header, Middle, Footer
		expect(removedCount).toBe(2);   // Old 1, Old 2
		expect(addedCount).toBe(3);     // New 1, New 2, New 3
	});
});
