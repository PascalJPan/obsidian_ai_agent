/**
 * Diff utilities for AI Assistant
 *
 * Computes diffs for previews only.
 * No vault writes.
 */

import { DiffLine } from '../types';

/**
 * Compute longest common subsequence of two string arrays
 */
export function longestCommonSubsequence(a: string[], b: string[]): string[] {
	const m = a.length;
	const n = b.length;

	const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	const lcs: string[] = [];
	let i = m, j = n;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) {
			lcs.unshift(a[i - 1]);
			i--;
			j--;
		} else if (dp[i - 1][j] > dp[i][j - 1]) {
			i--;
		} else {
			j--;
		}
	}

	return lcs;
}

/**
 * Compute diff between old and new content
 */
export function computeDiff(oldContent: string, newContent: string): DiffLine[] {
	const oldLines = oldContent.split('\n');
	const newLines = newContent.split('\n');

	const lcs = longestCommonSubsequence(oldLines, newLines);
	const diff: DiffLine[] = [];

	let oldIdx = 0;
	let newIdx = 0;
	let lcsIdx = 0;

	while (oldIdx < oldLines.length || newIdx < newLines.length) {
		if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx]) {
			if (newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
				diff.push({
					type: 'unchanged',
					lineNumber: oldIdx + 1,
					newLineNumber: newIdx + 1,
					content: oldLines[oldIdx]
				});
				oldIdx++;
				newIdx++;
				lcsIdx++;
			} else {
				diff.push({
					type: 'added',
					newLineNumber: newIdx + 1,
					content: newLines[newIdx]
				});
				newIdx++;
			}
		} else if (lcsIdx < lcs.length && newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
			diff.push({
				type: 'removed',
				lineNumber: oldIdx + 1,
				content: oldLines[oldIdx]
			});
			oldIdx++;
		} else if (oldIdx < oldLines.length && (lcsIdx >= lcs.length || oldLines[oldIdx] !== lcs[lcsIdx])) {
			diff.push({
				type: 'removed',
				lineNumber: oldIdx + 1,
				content: oldLines[oldIdx]
			});
			oldIdx++;
		} else if (newIdx < newLines.length) {
			diff.push({
				type: 'added',
				newLineNumber: newIdx + 1,
				content: newLines[newIdx]
			});
			newIdx++;
		}
	}

	return diff;
}
