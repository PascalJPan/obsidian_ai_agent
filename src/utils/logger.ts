/**
 * Structured logging utility for ObsidianAgent Plugin
 *
 * Provides categorized logging with timestamps.
 * Errors are always logged; log/warn are gated by debugEnabled().
 */

export type LogCategory =
	| 'CONTEXT'      // Context building operations
	| 'INDEX'        // Backlink/link indexing and BFS traversal
	| 'VALIDATE'     // Edit validation
	| 'FILTER'       // Edit filtering by rules
	| 'SEMANTIC'     // Semantic search operations
	| 'API'          // API calls
	| 'EDIT'         // Edit insertion and resolution
	| 'PARSE'        // Response parsing
	| 'TOKEN_LIMIT'; // Token limit enforcement

export interface Logger {
	log: (category: LogCategory, message: string, data?: unknown) => void;
	warn: (category: LogCategory, message: string, data?: unknown) => void;
	error: (category: LogCategory, message: string, data?: unknown) => void;
}

/**
 * Format data for logging output
 */
function formatData(data: unknown): string {
	if (data === undefined) return '';
	if (typeof data === 'string') return data;
	try {
		return JSON.stringify(data, null, 2);
	} catch {
		return String(data);
	}
}

/**
 * Get formatted timestamp for log entries
 */
function getTimestamp(): string {
	const now = new Date();
	return now.toISOString().substring(11, 23); // HH:MM:SS.mmm
}

/**
 * Create a logger instance with debug gating
 *
 * @param debugEnabled - Callback that returns whether debug logging is enabled
 * @returns Logger instance with log, warn, and error methods
 */
export function createLogger(debugEnabled: () => boolean): Logger {
	const formatMessage = (category: LogCategory, message: string, data?: unknown): string => {
		const timestamp = getTimestamp();
		const dataStr = formatData(data);
		const base = `[${timestamp}] [ObsidianAgent] [${category}] ${message}`;
		return dataStr ? `${base}\n${dataStr}` : base;
	};

	return {
		log: (category: LogCategory, message: string, data?: unknown): void => {
			if (debugEnabled()) {
				console.log(formatMessage(category, message, data));
			}
		},

		warn: (category: LogCategory, message: string, data?: unknown): void => {
			if (debugEnabled()) {
				console.warn(formatMessage(category, message, data));
			}
		},

		error: (category: LogCategory, message: string, data?: unknown): void => {
			// Errors are always logged, regardless of debug mode
			console.error(formatMessage(category, message, data));
		}
	};
}

/**
 * Summarize an array of items for logging (shows count + sample)
 */
export function summarizeArray<T>(items: T[], maxSample: number = 3): { count: number; sample: T[] } {
	return {
		count: items.length,
		sample: items.slice(0, maxSample)
	};
}

/**
 * Summarize a Set for logging
 */
export function summarizeSet<T>(set: Set<T>, maxSample: number = 3): { count: number; sample: T[] } {
	return summarizeArray([...set], maxSample);
}
