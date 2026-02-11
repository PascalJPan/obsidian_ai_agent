/**
 * Shared chat history formatting for ObsidianAgent
 *
 * Sends slim Q&A messages in the window (just text + brief summary tags).
 * Full details (edit content, file context, results) are available
 * on demand via the get_chat_history tool.
 */

import { ChatMessage } from '../../types';

/**
 * Build a brief summary tag for an assistant message's edit activity.
 * Returns empty string if no edits/results.
 */
function buildEditSummaryTag(msg: ChatMessage): string {
	const parts: string[] = [];
	if (msg.proposedEdits && msg.proposedEdits.length > 0) {
		parts.push(`${msg.proposedEdits.length} edit(s) proposed`);
	}
	if (msg.editResults) {
		if (msg.editResults.accepted !== undefined || msg.editResults.rejected !== undefined) {
			if (msg.editResults.accepted) parts.push(`${msg.editResults.accepted} accepted`);
			if (msg.editResults.rejected) parts.push(`${msg.editResults.rejected} rejected`);
		}
	}
	if (msg.notesRead && msg.notesRead.length > 0) {
		parts.push(`read ${msg.notesRead.length} note(s)`);
	}
	if (msg.webSources && msg.webSources.length > 0) {
		parts.push(`${msg.webSources.length} web source(s)`);
	}
	return parts.length > 0 ? `\n[${parts.join(', ')} — use get_chat_history for details]` : '';
}

/**
 * Build messages array for OpenAI API including chat history
 *
 * Creates a messages array with:
 * - System prompt
 * - Previous chat history (slim: Q&A text + brief summary tags)
 * - Current context/request
 *
 * Full details are available via get_chat_history tool.
 */
export function buildMessagesFromHistory(
	systemPrompt: string,
	currentContext: string,
	chatHistory: ChatMessage[],
	historyLength: number
): Array<{ role: string; content: string }> {
	const messages: Array<{ role: string; content: string }> = [
		{ role: 'system', content: systemPrompt }
	];

	// Add chat history (up to historyLength) — slim format
	if (historyLength > 0 && chatHistory.length > 1) {
		// Get messages except the most recent one (which is the current user message)
		const historyMessages = chatHistory.slice(0, -1).slice(-historyLength);

		for (const msg of historyMessages) {
			// Handle context-switch messages
			if (msg.type === 'context-switch') {
				messages.push({
					role: 'system',
					content: `[CONTEXT SWITCH: User navigated to "${msg.content}"]`
				});
				continue;
			}

			if (msg.role === 'user') {
				// Slim: just the user's text
				messages.push({
					role: 'user',
					content: msg.content
				});
			} else {
				// Slim: assistant response text + brief summary tag
				messages.push({
					role: 'assistant',
					content: msg.content + buildEditSummaryTag(msg)
				});
			}
		}
	}

	// Add current context/request
	messages.push({ role: 'user', content: currentContext });

	return messages;
}
