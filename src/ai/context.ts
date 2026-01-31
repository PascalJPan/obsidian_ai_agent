/**
 * Context utilities for AI Assistant
 *
 * Pure utility functions for context building.
 * Note: Functions that depend on Obsidian vault/app remain in main.ts
 */

/**
 * Add line numbers to content for AI context
 * Format: "N: content" where N starts at 1
 */
export function addLineNumbers(content: string): string {
	const lines = content.split('\n');
	return lines.map((line, index) => `${index + 1}: ${line}`).join('\n');
}
