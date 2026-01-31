/**
 * Pricing utilities for token cost calculation
 */

import { TokenUsage } from '../types';

// Pricing per 1M tokens (input/output) in USD
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
	'gpt-4o-mini': { input: 0.15, output: 0.60 },
	'gpt-4o': { input: 2.50, output: 10.00 },
	'gpt-4-turbo': { input: 10.00, output: 30.00 },
	'gpt-4': { input: 30.00, output: 60.00 },
	'gpt-4.5-preview': { input: 75.00, output: 150.00 },
	'o1-mini': { input: 1.10, output: 4.40 },
	'o1': { input: 7.50, output: 30.00 },
	'o3-mini': { input: 1.10, output: 4.40 },
};

/**
 * Calculate cost in USD for token usage
 */
export function calculateCost(usage: TokenUsage, model: string): number {
	const pricing = MODEL_PRICING[model];
	if (!pricing) {
		return 0;
	}

	const inputCost = (usage.promptTokens / 1_000_000) * pricing.input;
	const outputCost = (usage.completionTokens / 1_000_000) * pricing.output;

	return inputCost + outputCost;
}

/**
 * Format token usage for display
 * Example: "1,234 in + 567 out · ~$0.0025"
 */
export function formatTokenUsage(usage: TokenUsage, model: string): string {
	const cost = calculateCost(usage, model);
	const costStr = cost < 0.01
		? `$${cost.toFixed(4)}`
		: `$${cost.toFixed(2)}`;

	return `${usage.promptTokens.toLocaleString()} in + ${usage.completionTokens.toLocaleString()} out · ~${costStr}`;
}
