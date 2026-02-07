/**
 * Action tool definitions for the unified Agent
 *
 * Tools that take actions: edit_note, create_note, open_note, move_note,
 * update_properties, add_tags, link_notes, copy_notes, done, ask_user
 */

import { AgentCallbacks, AICapabilities, WebSource, WhitelistedCommand } from '../../types';
import { OpenAITool } from './vaultTools';

export const TOOL_EDIT_NOTE: OpenAITool = {
	type: 'function',
	function: {
		name: 'edit_note',
		description: 'Edit an existing note. Creates a pending edit block that the user can accept/reject. Read the note first to get correct line numbers.',
		parameters: {
			type: 'object',
			properties: {
				file: {
					type: 'string',
					description: 'Filename with .md extension (e.g., "My Note.md" or "Projects/Plan.md")'
				},
				position: {
					type: 'string',
					description: 'Where to edit: "start", "end", "after:## Heading", "insert:N", "replace:N", "replace:N-M", "delete:N", "delete:N-M"'
				},
				content: {
					type: 'string',
					description: 'Content to insert/replace with. For delete, use empty string.'
				}
			},
			required: ['file', 'position', 'content']
		}
	}
};

export const TOOL_CREATE_NOTE: OpenAITool = {
	type: 'function',
	function: {
		name: 'create_note',
		description: 'Create a new note in the vault. Parent folders are created automatically.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Full path with .md extension (e.g., "Projects/New Project.md")'
				},
				content: {
					type: 'string',
					description: 'Initial content for the note. Use [[wikilinks]] to link to other vault notes.'
				}
			},
			required: ['path', 'content']
		}
	}
};

export const TOOL_OPEN_NOTE: OpenAITool = {
	type: 'function',
	function: {
		name: 'open_note',
		description: 'Open a note in a new tab. Use when the user wants to navigate to a note.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path to the note to open'
				}
			},
			required: ['path']
		}
	}
};

export const TOOL_MOVE_NOTE: OpenAITool = {
	type: 'function',
	function: {
		name: 'move_note',
		description: 'Move/rename a note. All wikilinks in the vault are updated automatically.',
		parameters: {
			type: 'object',
			properties: {
				from_path: {
					type: 'string',
					description: 'Current path of the note'
				},
				to_path: {
					type: 'string',
					description: 'New path for the note (e.g., "Archive/Old Note.md")'
				}
			},
			required: ['from_path', 'to_path']
		}
	}
};

export const TOOL_UPDATE_PROPERTIES: OpenAITool = {
	type: 'function',
	function: {
		name: 'update_properties',
		description: 'Update YAML frontmatter properties of a note. Merges with existing properties.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path to the note'
				},
				properties: {
					type: 'object',
					description: 'Properties to set or update (e.g., {"status": "done", "priority": 1}). Set a property to null to remove it.'
				}
			},
			required: ['path', 'properties']
		}
	}
};

export const TOOL_ADD_TAGS: OpenAITool = {
	type: 'function',
	function: {
		name: 'add_tags',
		description: 'Add tags to a note\'s frontmatter. Does not remove existing tags.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path to the note'
				},
				tags: {
					type: 'array',
					items: { type: 'string' },
					description: 'Tags to add (with or without #, e.g., ["project", "active"])'
				}
			},
			required: ['path', 'tags']
		}
	}
};

export const TOOL_LINK_NOTES: OpenAITool = {
	type: 'function',
	function: {
		name: 'link_notes',
		description: 'Add a wikilink from one note to another. Appends [[target]] at the specified context or at the end.',
		parameters: {
			type: 'object',
			properties: {
				source: {
					type: 'string',
					description: 'Path of the note to add the link to'
				},
				target: {
					type: 'string',
					description: 'Path or name of the note to link to (will be converted to wikilink)'
				},
				context: {
					type: 'string',
					description: 'Optional: heading or section where to add the link (e.g., "## Related"). If omitted, appends at end.'
				}
			},
			required: ['source', 'target']
		}
	}
};

export const TOOL_COPY_NOTES: OpenAITool = {
	type: 'function',
	function: {
		name: 'copy_notes',
		description: 'Get the full content of multiple notes formatted for sharing. The user will see a "Copy" button.',
		parameters: {
			type: 'object',
			properties: {
				paths: {
					type: 'array',
					items: { type: 'string' },
					description: 'Paths of notes to include'
				}
			},
			required: ['paths']
		}
	}
};

export const TOOL_DONE: OpenAITool = {
	type: 'function',
	function: {
		name: 'done',
		description: 'Signal that you are finished. Provide a summary of what you did or the answer to the user\'s question.',
		parameters: {
			type: 'object',
			properties: {
				summary: {
					type: 'string',
					description: 'Summary of actions taken or answer to the question'
				}
			},
			required: ['summary']
		}
	}
};

export const TOOL_ASK_USER: OpenAITool = {
	type: 'function',
	function: {
		name: 'ask_user',
		description: 'Ask the user a clarifying question. Use when the task is ambiguous. Prefer offering choices.',
		parameters: {
			type: 'object',
			properties: {
				question: {
					type: 'string',
					description: 'The question to ask'
				},
				choices: {
					type: 'array',
					items: { type: 'string' },
					description: 'Optional: 2-5 answer choices'
				}
			},
			required: ['question']
		}
	}
};

export const TOOL_DELETE_NOTE: OpenAITool = {
	type: 'function',
	function: {
		name: 'delete_note',
		description: 'Move a note to trash. This is reversible — the note can be restored from .trash.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path to the note to delete'
				}
			},
			required: ['path']
		}
	}
};

/**
 * Build the execute_command tool definition with whitelisted commands baked into the description.
 */
export function buildExecuteCommandTool(whitelistedCommands: WhitelistedCommand[]): OpenAITool {
	const commandList = whitelistedCommands
		.map(c => `- "${c.name}" (${c.id}): ${c.description}`)
		.join('\n');
	return {
		type: 'function',
		function: {
			name: 'execute_command',
			description: `Execute a whitelisted Obsidian command.\n\nAVAILABLE COMMANDS:\n${commandList}`,
			parameters: {
				type: 'object',
				properties: {
					command: {
						type: 'string',
						description: 'Command ID from the available commands list'
					}
				},
				required: ['command']
			}
		}
	};
}

/**
 * Get action tools based on capabilities.
 * Filtering by disabledTools is handled in agent.ts.
 * In 'finalization' mode, excludes ask_user (only done + action tools).
 */
export function getActionTools(
	capabilities: AICapabilities,
	whitelistedCommands?: WhitelistedCommand[],
	mode: 'full' | 'finalization' = 'full'
): OpenAITool[] {
	const tools: OpenAITool[] = [TOOL_DONE];

	if (capabilities.canAdd || capabilities.canDelete) {
		tools.push(TOOL_EDIT_NOTE);
	}
	tools.push(TOOL_CREATE_NOTE);
	tools.push(TOOL_OPEN_NOTE);
	if (capabilities.canAdd || capabilities.canDelete) {
		tools.push(TOOL_MOVE_NOTE);
		tools.push(TOOL_UPDATE_PROPERTIES);
		tools.push(TOOL_ADD_TAGS);
		tools.push(TOOL_LINK_NOTES);
	}
	tools.push(TOOL_COPY_NOTES);
	tools.push(TOOL_DELETE_NOTE);
	if (whitelistedCommands && whitelistedCommands.length > 0) {
		tools.push(buildExecuteCommandTool(whitelistedCommands));
	}

	if (mode === 'full') {
		tools.push(TOOL_ASK_USER);
	}

	return tools;
}

// Track web sources gathered during action tool handling
export interface ActionToolState {
	webSources: WebSource[];
	notesRead: string[];
	notesCopied: string[];
	editsProposed: number;
}

/**
 * Handle an action tool call and return the result string
 */
export async function handleActionToolCall(
	name: string,
	args: Record<string, unknown>,
	callbacks: AgentCallbacks,
	state: ActionToolState,
	whitelistedCommands?: WhitelistedCommand[]
): Promise<{ result: string; done?: boolean }> {
	switch (name) {
		case 'edit_note': {
			const edit = {
				file: args.file as string,
				position: args.position as string,
				content: args.content as string
			};
			const result = await callbacks.proposeEdit(edit);
			if (result.success) {
				state.editsProposed++;
				return { result: `Edit applied to "${edit.file}" at position "${edit.position}". The user will see a pending edit block to accept/reject.` };
			} else {
				return { result: `Edit failed: ${result.error}. You can re-read the note and try again with corrected line numbers.` };
			}
		}

		case 'create_note': {
			const path = args.path as string;
			const content = args.content as string;
			const result = await callbacks.createNote(path, content);
			if (result.success) {
				state.editsProposed++;
				return { result: `Note created: "${path}". The user will see a banner to accept/reject.` };
			} else {
				return { result: `Failed to create note: ${result.error}` };
			}
		}

		case 'open_note': {
			const path = args.path as string;
			const result = await callbacks.openNote(path);
			if (result.success) {
				return { result: `Opened "${path}" in a new tab.` };
			} else {
				return { result: `Failed to open note: ${result.error}` };
			}
		}

		case 'move_note': {
			const fromPath = args.from_path as string;
			const toPath = args.to_path as string;
			const result = await callbacks.moveNote(fromPath, toPath);
			if (result.success) {
				return { result: `Moved "${fromPath}" → "${result.newPath || toPath}". All wikilinks updated.` };
			} else {
				return { result: `Failed to move note: ${result.error}` };
			}
		}

		case 'update_properties': {
			const path = args.path as string;
			const properties = args.properties as Record<string, unknown>;
			const result = await callbacks.updateProperties(path, properties);
			if (result.success) {
				return { result: `Updated properties of "${path}": ${Object.keys(properties).join(', ')}` };
			} else {
				return { result: `Failed to update properties: ${result.error}` };
			}
		}

		case 'add_tags': {
			const path = args.path as string;
			const tags = args.tags as string[];
			const result = await callbacks.addTags(path, tags);
			if (result.success) {
				return { result: `Added tags to "${path}": ${tags.join(', ')}` };
			} else {
				return { result: `Failed to add tags: ${result.error}` };
			}
		}

		case 'link_notes': {
			const source = args.source as string;
			const target = args.target as string;
			const context = args.context as string | undefined;
			const result = await callbacks.linkNotes(source, target, context);
			if (result.success) {
				return { result: `Added link [[${target.replace('.md', '')}]] to "${source}"${context ? ` at "${context}"` : ''}.` };
			} else {
				return { result: `Failed to link notes: ${result.error}` };
			}
		}

		case 'copy_notes': {
			const paths = args.paths as string[];
			const result = await callbacks.copyNotes(paths);
			for (const p of paths) {
				if (!state.notesRead.includes(p)) state.notesRead.push(p);
				if (!state.notesCopied.includes(p)) state.notesCopied.push(p);
			}
			return { result: `Prepared ${result.noteCount} note(s) for copying. The user will see a "Copy to clipboard" button.` };
		}

		case 'delete_note': {
			const path = args.path as string;
			if (!callbacks.deleteNote) return { result: 'Error: delete_note is not available.' };
			const result = await callbacks.deleteNote(path);
			if (result.success) {
				return { result: `Moved "${path}" to trash. The note can be restored from .trash.` };
			} else {
				return { result: `Failed to delete note: ${result.error}` };
			}
		}

		case 'execute_command': {
			const commandId = args.command as string;
			if (!callbacks.executeCommand) return { result: 'Error: execute_command is not available.' };
			// Hard enforcement: reject any command not in the whitelist
			const allowed = whitelistedCommands?.find(c => c.id === commandId || c.name === commandId);
			if (!allowed) {
				return { result: `Error: Command "${commandId}" is not in the whitelist. Only whitelisted commands can be executed.` };
			}
			const result = await callbacks.executeCommand(allowed.id);
			if (result.success) {
				return { result: `Executed command: "${allowed.name}" (${allowed.id})` };
			} else {
				return { result: `Failed to execute command: ${result.error}` };
			}
		}

		case 'done': {
			const summary = args.summary as string;
			return { result: summary, done: true };
		}

		case 'ask_user': {
			const question = args.question as string;
			const choices = args.choices as string[] | undefined;
			const userAnswer = await callbacks.askUser(question, choices);
			return { result: `User answered: "${userAnswer}"` };
		}

		default:
			return { result: `Unknown action tool: ${name}` };
	}
}
