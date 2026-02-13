/**
 * Vault tool definitions for the unified Agent
 *
 * 19 vault tools: search_vault, read_note, list_notes, get_links,
 * explore_structure, list_tags, get_selection, preview_pending_edits,
 * find_orphan_notes, find_unlinked_mentions, and more
 */

import { AgentCallbacks } from '../../types';

/** Strip leading slashes from path-like string args (AI sometimes writes "/Note.md" instead of "Note.md") */
export function normalizePathArgs(args: Record<string, unknown>): Record<string, unknown> {
	const pathKeys = ['path', 'file', 'from_path', 'to_path', 'folder', 'note_path'];
	const out = { ...args };
	for (const key of pathKeys) {
		if (typeof out[key] === 'string') {
			out[key] = (out[key] as string).replace(/^\/+/, '');
		}
	}
	if (Array.isArray(out['moves'])) {
		out['moves'] = (out['moves'] as Array<Record<string, unknown>>).map(m => ({
			...m,
			from_path: typeof m.from_path === 'string' ? m.from_path.replace(/^\/+/, '') : m.from_path,
			to_path: typeof m.to_path === 'string' ? m.to_path.replace(/^\/+/, '') : m.to_path,
		}));
	}
	if (Array.isArray(out['paths'])) {
		out['paths'] = (out['paths'] as string[]).map(p => typeof p === 'string' ? p.replace(/^\/+/, '') : p);
	}
	return out;
}

export interface OpenAITool {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: {
			type: string;
			properties: Record<string, unknown>;
			required?: string[];
		};
	};
}

// Tool definitions

export const TOOL_SEARCH_VAULT: OpenAITool = {
	type: 'function',
	function: {
		name: 'search_vault',
		description: 'Search for notes. Modes: "keyword" (fast — matches titles > headings > content), "semantic" (concept/topic similarity), "both" (combines both approaches for comprehensive results).',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search query - a word, phrase, or concept to search for'
				},
				mode: {
					type: 'string',
					enum: ['keyword', 'semantic', 'both'],
					description: 'Search mode: "keyword" for exact terms, "semantic" for concepts, "both" to combine'
				},
				limit: {
					type: 'number',
					description: 'Max results to return (default 10)'
				}
			},
			required: ['query']
		}
	}
};

export const TOOL_READ_NOTE: OpenAITool = {
	type: 'function',
	function: {
		name: 'read_note',
		description: 'Read the full content of a note with line numbers. Supports fuzzy path matching (e.g., "My Note" matches "Projects/My Note.md").',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path or name of the note (e.g., "Projects/My Note.md" or "My Note")'
				}
			},
			required: ['path']
		}
	}
};

export const TOOL_LIST_NOTES: OpenAITool = {
	type: 'function',
	function: {
		name: 'list_notes',
		description: 'List notes in the vault. Returns paths only by default (lightweight). Set preview_length > 0 to include content previews (use a lower limit when requesting previews). Use include_metadata for aliases/descriptions from YAML frontmatter.',
		parameters: {
			type: 'object',
			properties: {
				folder: {
					type: 'string',
					description: 'Folder path to filter by (e.g., "Projects/Active"). Use "" or "/" for root-level notes only. Omit to list all notes.'
				},
				limit: {
					type: 'number',
					description: 'Max notes to return (default 200)'
				},
				preview_length: {
					type: 'number',
					description: 'Character length of content preview per note. 0 = no preview, paths only (default 0). Set to e.g. 200 for previews.'
				},
				include_metadata: {
					type: 'boolean',
					description: 'Include aliases and descriptions from frontmatter (default: false)'
				}
			}
		}
	}
};

export const TOOL_GET_LINKS: OpenAITool = {
	type: 'function',
	function: {
		name: 'get_links',
		description: 'Get notes linked to/from a specific note. For multi-hop exploration, set depth > 1.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path to the note'
				},
				direction: {
					type: 'string',
					enum: ['in', 'out', 'both'],
					description: 'Link direction: "in" (backlinks), "out" (outgoing), or "both"'
				},
				depth: {
					type: 'number',
					description: 'How many hops to follow (1-3, default 1)'
				}
			},
			required: ['path']
		}
	}
};

export const TOOL_EXPLORE_STRUCTURE: OpenAITool = {
	type: 'function',
	function: {
		name: 'explore_structure',
		description: 'Two actions: "list_folder" to browse folder contents (set recursive=true for full tree, note_names=false to see only folders with note counts — ideal for getting a compact vault overview), "find_by_tag" to find notes with a specific tag.',
		parameters: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: ['list_folder', 'find_by_tag'],
					description: 'Action to perform'
				},
				folder: {
					type: 'string',
					description: 'For list_folder: folder path (use "/" or "" for root)'
				},
				tag: {
					type: 'string',
					description: 'For find_by_tag: tag to search (with or without #)'
				},
				recursive: {
					type: 'boolean',
					description: 'For list_folder: if true, returns a full indented tree of all nested files and subfolders instead of just immediate children (default: false)'
				},
				note_names: {
					type: 'boolean',
					description: 'For list_folder: if false, hides individual note names and only shows folders with a count of notes inside — useful for a compact structural overview (default: true)'
				}
			},
			required: ['action']
		}
	}
};

export const TOOL_LIST_TAGS: OpenAITool = {
	type: 'function',
	function: {
		name: 'list_tags',
		description: 'Get all tags used in the vault with their note counts.',
		parameters: {
			type: 'object',
			properties: {}
		}
	}
};

export const TOOL_GET_MANUAL_CONTEXT: OpenAITool = {
	type: 'function',
	function: {
		name: 'get_manual_context',
		description: 'Get the user\'s manually configured context notes. Returns notes selected via the Manual Context panel (linked notes, folder notes, semantic matches, manually added notes). Call this when the user refers to "my context", "manual context", or "based on my context". Use summary_only=true to get just note paths and previews without full content — useful to see what\'s available before deciding which notes to read in full.',
		parameters: {
			type: 'object',
			properties: {
				summary_only: {
					type: 'boolean',
					description: 'If true, returns only note paths and a 2-line preview instead of full content. Useful to see what context notes are available without consuming many tokens (default: false)'
				}
			}
		}
	}
};

export const TOOL_GET_PROPERTIES: OpenAITool = {
	type: 'function',
	function: {
		name: 'get_properties',
		description: 'Read YAML frontmatter properties from a note as JSON.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path or name of the note'
				}
			},
			required: ['path']
		}
	}
};

export const TOOL_GET_FILE_INFO: OpenAITool = {
	type: 'function',
	function: {
		name: 'get_file_info',
		description: 'Get file metadata: creation date, modification date, and size.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path or name of the note'
				}
			},
			required: ['path']
		}
	}
};

export const TOOL_FIND_DEAD_LINKS: OpenAITool = {
	type: 'function',
	function: {
		name: 'find_dead_links',
		description: 'Find broken [[wikilinks]] that point to non-existent notes. Optionally filter to a specific note.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Optional: check only this note for dead links. If omitted, scans the whole vault.'
				}
			}
		}
	}
};

export const TOOL_QUERY_NOTES: OpenAITool = {
	type: 'function',
	function: {
		name: 'query_notes',
		description: 'Filter notes by property values and/or dates. AND logic for property filters. Example: filter={status:"draft"}, has_property="due_date".',
		parameters: {
			type: 'object',
			properties: {
				filter: {
					type: 'object',
					description: 'Property key-value pairs to match (AND logic). Example: {"status": "draft", "type": "project"}'
				},
				modified_after: {
					type: 'string',
					description: 'ISO date string — only notes modified after this date'
				},
				modified_before: {
					type: 'string',
					description: 'ISO date string — only notes modified before this date'
				},
				has_property: {
					type: 'string',
					description: 'Only return notes that have this property defined (any value)'
				},
				sort_by: {
					type: 'string',
					enum: ['name', 'modified', 'created'],
					description: 'Sort results by name, modification date, or creation date'
				},
				limit: {
					type: 'number',
					description: 'Max results to return (default 20)'
				}
			}
		}
	}
};

export const TOOL_GET_VAULT_STATS: OpenAITool = {
	type: 'function',
	function: {
		name: 'get_vault_stats',
		description: 'Get a comprehensive overview of the vault: total notes, folders, top tags, total size, average note length, and recently modified notes. Zero parameters — call for a quick vault summary.',
		parameters: {
			type: 'object',
			properties: {}
		}
	}
};

export const TOOL_GET_CHAT_HISTORY: OpenAITool = {
	type: 'function',
	function: {
		name: 'get_chat_history',
		description: 'Retrieve full details of conversation messages — edit proposals, edit results (accepted/rejected), files viewed, web sources, etc. The chat window only shows slim Q&A text; call this to get the complete picture. Use when you need specifics about what was edited, which edits were accepted/rejected, or what files were involved.',
		parameters: {
			type: 'object',
			properties: {
				count: {
					type: 'number',
					description: 'Number of messages to retrieve (default 10, max 50)'
				},
				offset: {
					type: 'number',
					description: 'Skip this many messages from the most recent (default 0 = start from newest)'
				}
			}
		}
	}
};

export const TOOL_GET_NOTE_STATS: OpenAITool = {
	type: 'function',
	function: {
		name: 'get_note_stats',
		description: 'Get content statistics for one or more notes: word count, character count, line count, headings breakdown (h1-h6), paragraph count, code block count, and estimated reading time.',
		parameters: {
			type: 'object',
			properties: {
				paths: {
					type: 'array',
					items: { type: 'string' },
					description: 'Note paths to get stats for (batch support)'
				}
			},
			required: ['paths']
		}
	}
};

export const TOOL_GET_NOTE_CONNECTIONS: OpenAITool = {
	type: 'function',
	function: {
		name: 'get_note_connections',
		description: 'Get connection metrics for one or more notes: tags (count + list), outgoing links, backlinks, and embeds.',
		parameters: {
			type: 'object',
			properties: {
				paths: {
					type: 'array',
					items: { type: 'string' },
					description: 'Note paths to get connections for (batch support)'
				}
			},
			required: ['paths']
		}
	}
};

export const TOOL_GET_SELECTION: OpenAITool = {
	type: 'function',
	function: {
		name: 'get_selection',
		description: 'Get the currently selected text in the editor. Returns the selected text, file path, and line range. Returns null if nothing is selected or no editor is open.',
		parameters: {
			type: 'object',
			properties: {}
		}
	}
};

export const TOOL_PREVIEW_PENDING_EDITS: OpenAITool = {
	type: 'function',
	function: {
		name: 'preview_pending_edits',
		description: 'Preview pending ai-edit blocks in notes. Shows before/after for each pending edit. Optionally filter to a specific note.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Optional: only show edits in this note. If omitted, scans all notes.'
				}
			}
		}
	}
};

export const TOOL_FIND_ORPHAN_NOTES: OpenAITool = {
	type: 'function',
	function: {
		name: 'find_orphan_notes',
		description: 'Find notes with zero incoming AND zero outgoing links (completely disconnected from the graph). Useful for vault cleanup.',
		parameters: {
			type: 'object',
			properties: {
				limit: {
					type: 'number',
					description: 'Max results to return (default 50)'
				}
			}
		}
	}
};

export const TOOL_FIND_UNLINKED_MENTIONS: OpenAITool = {
	type: 'function',
	function: {
		name: 'find_unlinked_mentions',
		description: 'Find places where a note\'s name appears as plain text but is NOT linked with [[wikilinks]]. Useful for discovering linking opportunities.',
		parameters: {
			type: 'object',
			properties: {
				note_name: {
					type: 'string',
					description: 'The note name to search for (e.g., "My Note")'
				},
				target_path: {
					type: 'string',
					description: 'Optional: full path of the target note (for disambiguation when multiple notes share a name)'
				},
				limit: {
					type: 'number',
					description: 'Max results to return (default 20)'
				}
			},
			required: ['note_name']
		}
	}
};

export const ALL_VAULT_TOOLS: OpenAITool[] = [
	TOOL_SEARCH_VAULT,
	TOOL_READ_NOTE,
	TOOL_LIST_NOTES,
	TOOL_GET_LINKS,
	TOOL_EXPLORE_STRUCTURE,
	TOOL_LIST_TAGS,
	TOOL_GET_MANUAL_CONTEXT,
	TOOL_GET_PROPERTIES,
	TOOL_GET_FILE_INFO,
	TOOL_FIND_DEAD_LINKS,
	TOOL_QUERY_NOTES,
	TOOL_GET_VAULT_STATS,
	TOOL_GET_CHAT_HISTORY,
	TOOL_GET_NOTE_STATS,
	TOOL_GET_NOTE_CONNECTIONS,
	TOOL_GET_SELECTION,
	TOOL_PREVIEW_PENDING_EDITS,
	TOOL_FIND_ORPHAN_NOTES,
	TOOL_FIND_UNLINKED_MENTIONS
];

/**
 * Get all vault tools. Filtering by disabledTools is handled in agent.ts.
 */
export function getVaultTools(): OpenAITool[] {
	return ALL_VAULT_TOOLS;
}

/**
 * Handle a vault tool call and return the result string
 */
export async function handleVaultToolCall(
	name: string,
	rawArgs: Record<string, unknown>,
	callbacks: AgentCallbacks
): Promise<string> {
	const args = normalizePathArgs(rawArgs);
	switch (name) {
		case 'search_vault': {
			const query = args.query as string;
			const mode = (args.mode as string) || 'keyword';
			const limit = (args.limit as number) || 10;

			const results: string[] = [];

			if (mode === 'keyword' || mode === 'both') {
				const kwResults = await callbacks.searchKeyword(query, limit);
				if (kwResults.length > 0) {
					results.push('KEYWORD RESULTS:');
					for (const r of kwResults) {
						const linePart = r.lineNumber ? ` (line ${r.lineNumber})` : '';
						results.push(`- ${r.path} [${r.matchType}]${linePart}: ${r.matchContext}`);
					}
				} else {
					results.push('KEYWORD RESULTS: none');
				}
			}

			if (mode === 'semantic' || mode === 'both') {
				const semResults = await callbacks.searchSemantic(query, limit);
				if (semResults.length > 0) {
					results.push('SEMANTIC RESULTS:');
					for (const r of semResults) {
						const score = Math.round(r.score * 100);
						results.push(`- ${r.notePath} (${score}% similar)${r.heading ? ` [${r.heading}]` : ''}`);
					}
				} else {
					results.push('SEMANTIC RESULTS: none. If semantic search is expected to work, the user may need to enable embeddings in settings and build the index.');
				}
			}

			return results.join('\n');
		}

		case 'read_note': {
			const path = args.path as string;
			const result = await callbacks.readNote(path);
			if (!result) {
				return `Note not found: "${path}". Try search_vault to find the correct path.`;
			}
			if (result.excluded) {
				return `Note "${path}" is in an excluded folder and cannot be accessed.`;
			}
			return `=== ${result.path} (${result.lineCount} lines) ===\n${result.content}`;
		}

		case 'list_notes': {
			const folder = args.folder as string | undefined;
			const limit = (args.limit as number) || 200;
			const previewLength = (args.preview_length as number) || 0;
			const includeMetadata = args.include_metadata as boolean | undefined;

			if (includeMetadata) {
				const allNotes = await callbacks.getAllNotes(true);
				const filtered = folder !== undefined
					? (folder === '' || folder === '/')
						? allNotes.filter(n => !n.path.includes('/'))
						: allNotes.filter(n => n.path.startsWith(folder.endsWith('/') ? folder : folder + '/'))
					: allNotes;
				const limited = filtered.slice(0, limit);
				if (limited.length === 0) return 'No notes found.';
				return limited.map(n => {
					let line = n.path;
					if (n.aliases && n.aliases.length > 0) line += ` (aliases: ${n.aliases.join(', ')})`;
					if (n.description) line += ` — ${n.description}`;
					return line;
				}).join('\n');
			}

			const notes = await callbacks.listNotes(folder, limit, previewLength);
			if (notes.length === 0) return 'No notes found.';
			if (previewLength > 0) {
				return notes.map(n => `${n.path}: ${n.preview}`).join('\n');
			}
			return notes.map(n => n.path).join('\n');
		}

		case 'get_links': {
			const path = args.path as string;
			const direction = (args.direction as string) || 'both';
			const depth = (args.depth as number) || 1;
			const links = await callbacks.getLinks(path, direction, depth);
			if (links.length === 0) return `No links found for "${path}".`;
			return links.map(l => {
				const name = l.name || l.path.split('/').pop()?.replace(/\.md$/, '') || l.path;
				return `${l.direction === 'outgoing' ? '→' : '←'} ${name}`;
			}).join('\n');
		}

		case 'explore_structure': {
			const action = args.action as string;
			if (action !== 'list_folder' && action !== 'find_by_tag') {
				return `Error: Invalid action "${action}". Must be "list_folder" or "find_by_tag".`;
			}
			if (action === 'find_by_tag' && !args.tag) {
				return 'Error: "find_by_tag" requires a "tag" parameter.';
			}
			const validatedArgs: Record<string, unknown> = { action };
			if (action === 'list_folder') {
				if (args.folder !== undefined) validatedArgs.folder = String(args.folder);
				validatedArgs.recursive = !!args.recursive;
				validatedArgs.note_names = args.note_names !== false; // default true
			} else {
				validatedArgs.tag = String(args.tag);
			}
			return await callbacks.exploreStructure(action, validatedArgs);
		}

		case 'list_tags': {
			const tags = await callbacks.listTags();
			if (tags.length === 0) return 'No tags found in vault.';
			return tags.map(t => `${t.tag} (${t.count} notes)`).join('\n');
		}

		case 'get_manual_context': {
			const summaryOnly = !!args.summary_only;
			return await callbacks.getManualContext(summaryOnly);
		}

		case 'get_properties': {
			const path = args.path as string;
			if (!callbacks.getProperties) return 'Error: get_properties is not available.';
			const props = await callbacks.getProperties(path);
			if (props === null) return `Note not found: "${path}". Try search_vault to find the correct path.`;
			if (Object.keys(props).length === 0) return `"${path}" has no frontmatter properties.`;
			return JSON.stringify(props, null, 2);
		}

		case 'get_file_info': {
			const path = args.path as string;
			if (!callbacks.getFileInfo) return 'Error: get_file_info is not available.';
			const info = await callbacks.getFileInfo(path);
			if (info === null) return `Note not found: "${path}". Try search_vault to find the correct path.`;
			const created = new Date(info.created).toISOString();
			const modified = new Date(info.modified).toISOString();
			const sizeKB = (info.size / 1024).toFixed(1);
			return `Created: ${created}\nModified: ${modified}\nSize: ${sizeKB} KB (${info.size} bytes)`;
		}

		case 'find_dead_links': {
			const path = args.path as string | undefined;
			if (!callbacks.findDeadLinks) return 'Error: find_dead_links is not available.';
			const deadLinks = await callbacks.findDeadLinks(path);
			if (deadLinks.length === 0) return path ? `No broken links in "${path}".` : 'No broken links found in the vault.';
			return deadLinks.map(d => `${d.source} → [[${d.deadLink}]] (broken)`).join('\n');
		}

		case 'query_notes': {
			const filter = (args.filter as Record<string, unknown>) || {};
			const options = {
				modified_after: args.modified_after as string | undefined,
				modified_before: args.modified_before as string | undefined,
				has_property: args.has_property as string | undefined,
				sort_by: args.sort_by as 'name' | 'modified' | 'created' | undefined,
				limit: (args.limit as number) || 20
			};
			if (!callbacks.queryNotes) return 'Error: query_notes is not available.';
			const results = await callbacks.queryNotes(filter, options);
			if (results.length === 0) return 'No notes matched the query.';
			return results.map(r => {
				let line = r.path;
				if (r.matchingProperties && Object.keys(r.matchingProperties).length > 0) {
					line += ` | ${JSON.stringify(r.matchingProperties)}`;
				}
				if (r.modified) {
					line += ` | modified: ${new Date(r.modified).toISOString().split('T')[0]}`;
				}
				return line;
			}).join('\n');
		}

		case 'get_vault_stats': {
			if (!callbacks.getVaultStats) return 'Error: get_vault_stats is not available.';
			return await callbacks.getVaultStats();
		}

		case 'get_chat_history': {
			if (!callbacks.getChatHistory) return 'No chat history available.';
			const count = Math.min(Math.max((args.count as number) || 10, 1), 50);
			const offset = Math.max((args.offset as number) || 0, 0);
			const result = await callbacks.getChatHistory(offset, count);
			if (result.messages.length === 0) return 'No chat history available.';
			const lines: string[] = [`CHAT HISTORY DETAILS (${result.messages.length} of ${result.totalAvailable} total messages):`];
			for (const msg of result.messages) {
				const ts = msg.timestamp instanceof Date
					? msg.timestamp.toLocaleString()
					: new Date(msg.timestamp).toLocaleString();
				const roleLabel = msg.role === 'user' ? 'USER' : msg.role === 'assistant' ? 'ASSISTANT' : 'SYSTEM';
				const msgLines: string[] = [];
				let header = `[${ts}] ${roleLabel}`;
				if (msg.activeFile) header += ` (viewing: ${msg.activeFile})`;
				msgLines.push(header);
				msgLines.push(msg.content.substring(0, 800) + (msg.content.length > 800 ? '...' : ''));
				// Full edit details
				if (msg.proposedEdits && msg.proposedEdits.length > 0) {
					msgLines.push(`  EDITS PROPOSED (${msg.proposedEdits.length}):`);
					for (const edit of msg.proposedEdits) {
						msgLines.push(`    - File: "${edit.file}", Position: "${edit.position}"`);
						msgLines.push(`      Content: "${edit.content.substring(0, 300)}${edit.content.length > 300 ? '...' : ''}"`);
					}
				}
				// Edit results
				if (msg.editResults) {
					const parts: string[] = [];
					if (msg.editResults.success > 0) parts.push(`${msg.editResults.success} proposed`);
					if (msg.editResults.failed > 0) parts.push(`${msg.editResults.failed} failed`);
					if (msg.editResults.accepted) parts.push(`${msg.editResults.accepted} accepted`);
					if (msg.editResults.rejected) parts.push(`${msg.editResults.rejected} rejected`);
					if (msg.editResults.pending) parts.push(`${msg.editResults.pending} pending`);
					if (parts.length > 0) msgLines.push(`  EDIT RESULTS: ${parts.join(', ')}`);
					if (msg.editResults.failures.length > 0) {
						for (const f of msg.editResults.failures) {
							msgLines.push(`    FAILED: "${f.file}" — ${f.error}`);
						}
					}
				}
				// Web sources
				if (msg.webSources && msg.webSources.length > 0) {
					msgLines.push(`  WEB SOURCES: ${msg.webSources.map(s => `${s.title} (${s.url})`).join(', ')}`);
				}
				// Notes read
				if (msg.notesRead && msg.notesRead.length > 0) {
					msgLines.push(`  NOTES READ: ${msg.notesRead.join(', ')}`);
				}
				lines.push(msgLines.join('\n'));
			}
			return lines.join('\n---\n');
		}

		case 'get_note_stats': {
			if (!callbacks.getNoteStats) return 'Error: get_note_stats is not available.';
			const paths = args.paths as string[];
			if (!Array.isArray(paths) || paths.length === 0) return 'Error: "paths" must be a non-empty array.';
			const results = await callbacks.getNoteStats(paths);
			return JSON.stringify(results, null, 2);
		}

		case 'get_note_connections': {
			if (!callbacks.getNoteConnections) return 'Error: get_note_connections is not available.';
			const paths = args.paths as string[];
			if (!Array.isArray(paths) || paths.length === 0) return 'Error: "paths" must be a non-empty array.';
			const results = await callbacks.getNoteConnections(paths);
			return JSON.stringify(results, null, 2);
		}

		case 'get_selection': {
			if (!callbacks.getSelection) return 'Error: get_selection is not available.';
			const selection = await callbacks.getSelection();
			if (!selection) return 'No text is currently selected (or no editor is open).';
			return `SELECTED TEXT in "${selection.file}" (lines ${selection.startLine}-${selection.endLine}):\n${selection.text}`;
		}

		case 'preview_pending_edits': {
			if (!callbacks.previewPendingEdits) return 'Error: preview_pending_edits is not available.';
			const path = args.path as string | undefined;
			return await callbacks.previewPendingEdits(path);
		}

		case 'find_orphan_notes': {
			if (!callbacks.findOrphanNotes) return 'Error: find_orphan_notes is not available.';
			const limit = (args.limit as number) || 50;
			const orphans = await callbacks.findOrphanNotes();
			const limited = orphans.slice(0, limit);
			if (limited.length === 0) return 'No orphan notes found — all notes are connected.';
			let result = `Found ${orphans.length} orphan note(s) (zero links in or out)`;
			if (orphans.length > limit) result += ` — showing first ${limit}`;
			result += ':\n' + limited.join('\n');
			return result;
		}

		case 'find_unlinked_mentions': {
			if (!callbacks.findUnlinkedMentions) return 'Error: find_unlinked_mentions is not available.';
			const noteName = args.note_name as string;
			if (!noteName) return 'Error: "note_name" is required.';
			const targetPath = args.target_path as string | undefined;
			const limit = (args.limit as number) || 20;
			const mentions = await callbacks.findUnlinkedMentions(noteName, targetPath);
			const limited = mentions.slice(0, limit);
			if (limited.length === 0) return `No unlinked mentions of "${noteName}" found.`;
			let result = `Found ${mentions.length} unlinked mention(s) of "${noteName}"`;
			if (mentions.length > limit) result += ` — showing first ${limit}`;
			result += ':\n' + limited.map(m => `- ${m.file} (line ${m.line}): ${m.context}`).join('\n');
			return result;
		}

		default:
			return `Unknown vault tool: ${name}`;
	}
}
