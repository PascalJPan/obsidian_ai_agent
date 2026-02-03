/**
 * Context utilities for ObsidianAgent
 *
 * Pure utility functions for context building.
 * Note: Functions that depend on Obsidian vault/app remain in main.ts
 */

/**
 * Strip pending AI edit blocks from content before sending to AI.
 * This prevents the AI from seeing/editing its own pending edit markup,
 * which would cause nested/malformed edit blocks.
 *
 * Removes:
 * - ```ai-edit\n{...}\n``` code blocks
 * - ```ai-new-note\n{...}\n``` code blocks
 * - The pending edit tag (e.g., #ai_edit)
 * - Cleans up extra blank lines left behind
 */
export function stripPendingEditBlocks(content: string, pendingEditTag: string): string {
	// Remove ai-edit code blocks (including any content inside)
	let result = content.replace(/```ai-edit\n[\s\S]*?```\n?/g, '');

	// Remove ai-new-note code blocks
	result = result.replace(/```ai-new-note\n[\s\S]*?```\n?/g, '');

	// Remove the pending edit tag (escape special regex chars in case tag has them)
	const escapedTag = pendingEditTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	result = result.replace(new RegExp(escapedTag + '\\n?', 'g'), '');

	// Clean up multiple consecutive blank lines (more than 2 newlines -> 2)
	result = result.replace(/\n{3,}/g, '\n\n');

	// Trim trailing whitespace at end of file
	result = result.trimEnd();

	return result;
}

/**
 * Add line numbers to content for AI context
 * Format: "N: content" where N starts at 1
 */
export function addLineNumbers(content: string): string {
	const lines = content.split('\n');
	return lines.map((line, index) => `${index + 1}: ${line}`).join('\n');
}
