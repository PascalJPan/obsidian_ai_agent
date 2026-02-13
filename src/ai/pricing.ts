/**
 * Pricing utilities for token cost calculation
 */

import { TokenUsage } from '../types';

// Pricing per 1M tokens (input/output) in USD
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
	// GPT-5 series
	'gpt-5-nano': { input: 0.05, output: 0.40 },
	'gpt-5-mini': { input: 0.25, output: 2.00 },
	'gpt-5': { input: 1.25, output: 10.00 },
	'gpt-5.1': { input: 1.25, output: 10.00 },
	'gpt-5.2': { input: 1.75, output: 14.00 },
	// GPT-4.1 series
	'gpt-4.1-nano': { input: 0.20, output: 0.80 },
	'gpt-4.1-mini': { input: 0.70, output: 2.80 },
	'gpt-4.1': { input: 3.50, output: 14.00 },
	// GPT-4o (kept for compatibility)
	'gpt-4o-mini': { input: 0.15, output: 0.60 },
	'gpt-4o': { input: 2.50, output: 10.00 },
};

/**
 * Calculate cost in USD for token usage
 * @param overrides - Sparse user overrides for model pricing (only edited models)
 */
export function calculateCost(usage: TokenUsage, model: string, overrides?: Record<string, { input: number; output: number }>): number {
	const pricing = overrides?.[model] ?? MODEL_PRICING[model];
	if (!pricing) {
		return 0;
	}

	const cached = usage.cachedTokens ?? 0;
	const uncached = usage.promptTokens - cached;
	const inputCost = ((uncached / 1_000_000) * pricing.input)
		+ ((cached / 1_000_000) * pricing.input * 0.5);
	const outputCost = (usage.completionTokens / 1_000_000) * pricing.output;

	return inputCost + outputCost;
}

/**
 * Format token usage for display
 * Example: "1,234 in + 567 out · ~$0.0025"
 * If model pricing is unknown, omits cost instead of showing $0.0000
 * @param overrides - Sparse user overrides for model pricing (only edited models)
 */
export function formatTokenUsage(usage: TokenUsage, model: string, overrides?: Record<string, { input: number; output: number }>): string {
	const pricing = overrides?.[model] ?? MODEL_PRICING[model];
	const cached = usage.cachedTokens ?? 0;
	const inLabel = cached > 0
		? `${usage.promptTokens.toLocaleString()} in (${cached.toLocaleString()} cached)`
		: `${usage.promptTokens.toLocaleString()} in`;
	const tokenStr = `${inLabel} + ${usage.completionTokens.toLocaleString()} out`;

	if (!pricing) {
		return tokenStr;
	}

	const cost = calculateCost(usage, model, overrides);
	const costStr = cost < 0.01
		? `$${cost.toFixed(4)}`
		: `$${cost.toFixed(2)}`;

	return `${tokenStr} · ~${costStr}`;
}
