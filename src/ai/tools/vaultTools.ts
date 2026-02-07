/**
 * Vault tool definitions for the unified Agent
 *
 * 6 tools for vault exploration: search_vault, read_note, list_notes,
 * get_links, explore_structure, list_tags
 */

import { AgentCallbacks } from '../../types';

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
		description: 'List notes with brief previews. Optionally filter by folder. Use include_metadata to also show aliases and descriptions from YAML frontmatter.',
		parameters: {
			type: 'object',
			properties: {
				folder: {
					type: 'string',
					description: 'Optional folder path to filter by (e.g., "Projects/Active")'
				},
				limit: {
					type: 'number',
					description: 'Max notes to return (default 30, max 50)'
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
		description: 'Two actions: "list_folder" to see files/subfolders in a folder, "find_by_tag" to find notes with a specific tag.',
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
					description: 'For list_folder: include subfolders (default: false)'
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
		description: 'Get the user\'s manually configured context notes. Returns all notes selected via the Manual Context panel (linked notes, folder notes, semantic matches, manually added notes) with line-numbered content. Call this when the user refers to "my context", "manual context", or "based on my context".',
		parameters: { type: 'object', properties: {} }
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
	TOOL_QUERY_NOTES
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
	args: Record<string, unknown>,
	callbacks: AgentCallbacks
): Promise<string> {
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
						results.push(`- ${r.path} [${r.matchType}]: ${r.matchContext}`);
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
					results.push('SEMANTIC RESULTS: none (no embedding index or no matches)');
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
			const limit = (args.limit as number) || 30;
			const includeMetadata = args.include_metadata as boolean | undefined;

			if (includeMetadata) {
				const allNotes = await callbacks.getAllNotes(true);
				const filtered = folder
					? allNotes.filter(n => n.path.startsWith(folder.endsWith('/') ? folder : folder + '/'))
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

			const notes = await callbacks.listNotes(folder, limit);
			if (notes.length === 0) return 'No notes found.';
			return notes.map(n => `${n.path}: ${n.preview}`).join('\n');
		}

		case 'get_links': {
			const path = args.path as string;
			const direction = (args.direction as string) || 'both';
			const depth = (args.depth as number) || 1;
			const links = await callbacks.getLinks(path, direction, depth);
			if (links.length === 0) return `No links found for "${path}".`;
			return links.map(l => `${l.direction === 'outgoing' ? '→' : '←'} ${l.path}`).join('\n');
		}

		case 'explore_structure': {
			const action = args.action as string;
			return await callbacks.exploreStructure(action, args);
		}

		case 'list_tags': {
			const tags = await callbacks.listTags();
			if (tags.length === 0) return 'No tags found in vault.';
			return tags.map(t => `${t.tag} (${t.count} notes)`).join('\n');
		}

		case 'get_manual_context':
			return await callbacks.getManualContext();

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

		default:
			return `Unknown vault tool: ${name}`;
	}
}
