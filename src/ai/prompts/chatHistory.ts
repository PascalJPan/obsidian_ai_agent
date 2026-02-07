/**
 * Shared chat history formatting for ObsidianAgent
 *
 * Used by both main.ts (buildMessagesWithHistory) and agent.ts (unified agent).
 * Standardizes truncation at 500 characters for edit content previews.
 */

import { ChatMessage } from '../../types';

// Truncation limit for edit content in chat history
const EDIT_CONTENT_TRUNCATION = 500;

/**
 * Build messages array for OpenAI API including chat history
 *
 * Creates a messages array with:
 * - System prompt
 * - Previous chat history (with rich context about edits, files, results)
 * - Current context/request
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

	// Add chat history (up to historyLength)
	if (historyLength > 0 && chatHistory.length > 1) {
		// Get messages except the most recent one (which is the current user message)
		const historyMessages = chatHistory.slice(0, -1).slice(-historyLength);

		for (const msg of historyMessages) {
			// Handle context-switch messages
			if (msg.type === 'context-switch') {
				messages.push({
					role: 'system',
					content: `[CONTEXT SWITCH: User navigated to note "${msg.content}" (${msg.activeFile}). Messages after this point refer to this note as the active context.]`
				});
				continue;
			}

			// Build rich context for the message
			let messageContent = '';

			if (msg.role === 'user') {
				// Include active file context for user messages
				if (msg.activeFile) {
					messageContent += `[User was viewing: ${msg.activeFile}]\n`;
				}
				messageContent += msg.content;
			} else {
				// For assistant messages, include edit details
				messageContent = msg.content;

				// Add proposed edits details if present
				if (msg.proposedEdits && msg.proposedEdits.length > 0) {
					messageContent += '\n\n[EDITS I PROPOSED:]\n';
					for (const edit of msg.proposedEdits) {
						messageContent += `- File: "${edit.file}", Position: "${edit.position}"\n`;
						messageContent += `  Content: "${edit.content.substring(0, EDIT_CONTENT_TRUNCATION)}${edit.content.length > EDIT_CONTENT_TRUNCATION ? '...' : ''}"\n`;
					}
				}

				// Add edit results if present
				if (msg.editResults) {
					// Show user feedback if available (accepted/rejected/pending)
					if (msg.editResults.accepted !== undefined || msg.editResults.rejected !== undefined) {
						const parts: string[] = [];
						if (msg.editResults.accepted) parts.push(`${msg.editResults.accepted} accepted`);
						if (msg.editResults.rejected) parts.push(`${msg.editResults.rejected} rejected`);
						if (msg.editResults.pending) parts.push(`${msg.editResults.pending} pending`);
						if (parts.length > 0) {
							messageContent += `\n[EDIT FEEDBACK: ${parts.join(', ')}]`;
						}
					} else if (msg.editResults.success > 0 || msg.editResults.failed > 0) {
						messageContent += `\n[EDIT RESULTS: ${msg.editResults.success} proposed, ${msg.editResults.failed} failed]`;
					}
					if (msg.editResults.failures.length > 0) {
						messageContent += '\n[FAILURES:]\n';
						for (const failure of msg.editResults.failures) {
							messageContent += `- "${failure.file}": ${failure.error}\n`;
						}
					}
				}
			}

			messages.push({
				role: msg.role === 'user' ? 'user' : 'assistant',
				content: messageContent
			});
		}
	}

	// Add current context/request
	messages.push({ role: 'user', content: currentContext });

	return messages;
}
