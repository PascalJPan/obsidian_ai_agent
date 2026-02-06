/**
 * Scout Agent (Context Agent) prompts, tool definitions, and message templates
 *
 * Contains:
 * - 14 tool definitions for OpenAI function calling
 * - OpenAITool interface
 * - getAvailableTools() builder
 * - buildContextAgentSystemPrompt()
 * - Message template helpers (initial message, final round warning, exploration status)
 * - Finding size limits
 */

import { ScoutToolConfig } from '../../types';

// Max characters per finding (~2000 tokens)
export const MAX_FINDING_CHARS = 8000;
// Max total characters across all findings (~5000 tokens)
export const MAX_TOTAL_FINDINGS_CHARS = 50000;

// Generic OpenAI tool definition type
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

// Individual tool definitions for OpenAI function calling
export const TOOL_UPDATE_SELECTION: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'update_selection',
		description: 'Update your current selection of relevant notes. CRITICAL: Call this after each exploration step to save your progress. Set confidence to "done" when you have enough context.',
		parameters: {
			type: 'object',
			properties: {
				selectedPaths: {
					type: 'array',
					items: { type: 'string' },
					description: 'Current best picks - full paths (e.g., "Projects/My Project.md")'
				},
				reasoning: {
					type: 'string',
					description: 'Why these notes are relevant to the task'
				},
				confidence: {
					type: 'string',
					enum: ['exploring', 'confident', 'done'],
					description: '"exploring" = still looking, "confident" = good selection but may continue, "done" = finished exploring'
				}
			},
			required: ['selectedPaths', 'reasoning', 'confidence']
		}
	}
};

export const TOOL_FETCH_NOTE: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'fetch_note',
		description: 'Get the full content of a specific note to verify its relevance.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path to the note (e.g., "Projects/My Project.md")'
				}
			},
			required: ['path']
		}
	}
};

export const TOOL_LIST_NOTES: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'list_notes',
		description: 'List notes with brief previews. Use to get an overview of available notes.',
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
				}
			}
		}
	}
};

export const TOOL_SEARCH_KEYWORD: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'search_keyword',
		description: 'Search for notes containing a keyword. Results prioritized: title matches > heading matches > content matches. Fast and deterministic.',
		parameters: {
			type: 'object',
			properties: {
				keyword: {
					type: 'string',
					description: 'The word or phrase to search for'
				},
				limit: {
					type: 'number',
					description: 'Max results (default from settings, typically 10)'
				}
			},
			required: ['keyword']
		}
	}
};

export const TOOL_SEARCH_SEMANTIC: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'search_semantic',
		description: 'Search for notes similar to a custom query. Best for exploring general concepts or topics.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search query - describe what you\'re looking for'
				},
				topK: {
					type: 'number',
					description: 'Number of results (default 10, max 20)'
				}
			},
			required: ['query']
		}
	}
};

export const TOOL_SEARCH_TASK_RELEVANT: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'search_task_relevant',
		description: 'Search for notes relevant to a task goal. Combines task + current note context for better matching. Use as your default semantic search.',
		parameters: {
			type: 'object',
			properties: {
				task: {
					type: 'string',
					description: 'The task description - what you need to accomplish'
				},
				topK: {
					type: 'number',
					description: 'Number of results (default 10)'
				}
			},
			required: ['task']
		}
	}
};

export const TOOL_GET_LINKS: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'get_links',
		description: 'Get notes directly linked to/from a specific note. For single-hop exploration.',
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
				}
			},
			required: ['path']
		}
	}
};

export const TOOL_GET_LINKS_RECURSIVE: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'get_links_recursive',
		description: 'Get all notes within N hops of a note. Efficient multi-hop exploration in one call.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path to the starting note'
				},
				depth: {
					type: 'number',
					description: 'How many hops to follow (1-3)'
				},
				direction: {
					type: 'string',
					enum: ['in', 'out', 'both'],
					description: 'Link direction: "in" (backlinks), "out" (outgoing), or "both"'
				}
			},
			required: ['path']
		}
	}
};

export const TOOL_VIEW_ALL_NOTES: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'view_all_notes',
		description: 'Get a list of ALL note names in the vault with their aliases and descriptions from YAML frontmatter. Use this to get a complete overview of available notes without fetching content.',
		parameters: {
			type: 'object',
			properties: {
				includeAliases: {
					type: 'boolean',
					description: 'Include aliases from frontmatter (default: true)'
				},
				includeDescriptions: {
					type: 'boolean',
					description: 'Include description field from frontmatter (default: true)'
				}
			}
		}
	}
};

export const TOOL_EXPLORE_VAULT: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'explore_vault',
		description: 'Explore vault structure: list folder contents or find notes by tag.',
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

export const TOOL_LIST_ALL_TAGS: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'list_all_tags',
		description: 'Get a list of all tags used in the vault with their note counts. Use this to discover what tags exist before searching by tag.',
		parameters: {
			type: 'object',
			properties: {}
		}
	}
};

export const TOOL_ASK_USER: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'ask_user',
		description: 'Ask the user a clarifying question. Use when the task is ambiguous or you need direction on which notes/topics to focus on. Prefer multiple choice (2-5 options) but open-ended is fine if needed.',
		parameters: {
			type: 'object',
			properties: {
				question: {
					type: 'string',
					description: 'The question to ask the user'
				},
				options: {
					type: 'array',
					items: { type: 'string' },
					description: 'Optional: 2-5 answer choices. If provided, user can respond with number (1,2,3...) or type freely.'
				}
			},
			required: ['question']
		}
	}
};

export const TOOL_RECORD_FINDING: OpenAITool = {
	type: 'function' as const,
	function: {
		name: 'record_finding',
		description: 'Record data that directly answers the user\'s question (tag lists, folder structures, vault statistics). This data will be passed to the Task Agent. The Task Agent CANNOT see your tool call results — only what you explicitly record here.',
		parameters: {
			type: 'object',
			properties: {
				label: {
					type: 'string',
					description: 'Short label for this finding (e.g., "Vault Tags", "Folder Structure")'
				},
				data: {
					type: 'string',
					description: 'The finding content - pre-formatted for the Task Agent (max ~8000 chars)'
				}
			},
			required: ['label', 'data']
		}
	}
};

/**
 * Get the list of available tools based on configuration
 */
export function getAvailableTools(config: ScoutToolConfig): OpenAITool[] {
	// update_selection, fetch_note, and record_finding are always available
	const tools: OpenAITool[] = [TOOL_UPDATE_SELECTION, TOOL_FETCH_NOTE, TOOL_RECORD_FINDING];

	if (config.listNotes) tools.push(TOOL_LIST_NOTES);
	if (config.searchKeyword) tools.push(TOOL_SEARCH_KEYWORD);
	if (config.searchSemantic) tools.push(TOOL_SEARCH_SEMANTIC);
	if (config.searchTaskRelevant) tools.push(TOOL_SEARCH_TASK_RELEVANT);
	if (config.getLinks) tools.push(TOOL_GET_LINKS);
	if (config.getLinksRecursive) tools.push(TOOL_GET_LINKS_RECURSIVE);
	if (config.viewAllNotes) tools.push(TOOL_VIEW_ALL_NOTES);
	if (config.exploreVault) tools.push(TOOL_EXPLORE_VAULT);
	if (config.listAllTags) tools.push(TOOL_LIST_ALL_TAGS);
	if (config.askUser) tools.push(TOOL_ASK_USER);

	return tools;
}

/**
 * Build system prompt for the Scout (Context) Agent
 */
export function buildContextAgentSystemPrompt(maxNotes: number, tokenLimit?: number, showTokenBudget?: boolean, askUserEnabled?: boolean): string {
	let prompt = `You are a context curator for an AI assistant. Your goal: find notes that will help accomplish the user's task.

## TASK COMPLEXITY RECOGNITION

SIMPLE TASKS (finish in 1-2 iterations):
- "All linked notes" → get_links() + update_selection(done)
- "Notes in this folder" → list_notes(folder) + done
- "Notes with tag X" → explore_vault(find_by_tag) + done
- "Current note only" → just include current note + done
- Any task where your first tool call gives you everything needed → you can finish early

COMPLEX TASKS (explore thoroughly):
- "Find relevant context for..." → semantic search + follow links
- "Notes about topic X" → keyword + semantic + multi-hop exploration
- Open-ended questions → broad exploration needed

Don't over-explore. If you have what is necessary, finish immediately.

## WORKFLOW
1. Analyze the task - is it simple or complex?
2. Explore using tools (call multiple tools per turn for efficiency)
3. Save progress after each step (see CRITICAL RULES)
4. When confident you have enough context, set confidence: "done"

## SEARCH TIPS
- Specific terms → search_keyword; concepts → search_task_relevant (default) or search_semantic
- Follow promising results with get_links or get_links_recursive for multi-hop exploration
- Call multiple tools in parallel to explore efficiently

## MULTI-HOP EXAMPLE
1. search_keyword("project") → finds "Projects.md" (title match)
2. get_links_recursive("Projects.md", depth=2) → discovers "Roadmap.md", "Tasks.md"
3. These linked notes may be more relevant than direct search results!

## WHEN TO FETCH vs JUST SELECT
- For CLEAR-CUT tasks ("all notes with tag X", "notes in folder Y", "linked notes"), just select and finalize - no need to fetch
- If note titles clearly match the task, selecting without fetch is fine
- For semantic matches you're unsure about, verify with fetch_note()`;

	// Add record_finding guidance
	prompt += `

## RECORDING FINDINGS
When you discover data that directly answers the user's question (tag lists, folder structures, vault statistics), call record_finding() to pass it to the Task Agent.
- The Task Agent CANNOT see your tool call results — only what you explicitly record
- Use this for data the user asked about, not for intermediate exploration results
- Keep findings concise (under 2000 tokens each)
- Example: user asks "what tags do I use?" → call list_all_tags, then record_finding with the results`;

	// Add ask_user guidance if enabled
	if (askUserEnabled) {
		prompt += `

## ASKING FOR CLARIFICATION
If the task is ambiguous or you're unsure which direction to take, use ask_user() to clarify.
Good times to ask:
- Multiple possible interpretations of the task
- User refers to something that could match multiple notes/topics
- Need to know scope or preference
Keep questions concise with clear options when possible.`;
	}

	// Add token budget information if enabled
	if (showTokenBudget && tokenLimit) {
		prompt += `

## TOKEN BUDGET
Your selections have a ${tokenLimit.toLocaleString()} token budget. Prioritize concise, highly relevant notes.
When you call update_selection(), you'll see an estimate of total tokens for your selection.
Notes exceeding the budget will be automatically removed, lowest priority first.`;
	}

	prompt += `

## CRITICAL RULES
- Call update_selection() after EACH exploration step with your reasoning
- This ensures we always have your best picks even if exploration is interrupted
- Select up to ${maxNotes} notes maximum. Exclude notes only tangentially related to the task.
- Include the current note ONLY if it's relevant to the task
- If user asks for "only 1 note" or specifies a count, respect that exactly
- Fewer highly relevant notes is better than many tangential ones
- If the task is a question about vault structure (tags, folders, statistics), use record_finding() to capture the answer data
- When done, set confidence: "done" to finish exploration`;

	return prompt;
}

// Message template: Initial message for Scout Agent with current file context
export function buildScoutInitialMessage(task: string, currentFilePath: string | null, currentFileContent: string): string {
	if (currentFilePath && currentFileContent) {
		return `User's task: ${task}

Current note (${currentFilePath}):
---
${currentFileContent.substring(0, 4000)}${currentFileContent.length > 4000 ? '\n[... truncated]' : ''}
---

Find the most relevant notes for this task. Remember to call update_selection() after each exploration step!`;
	} else {
		return `User's task: ${task}

No note is currently open. Start by exploring the vault structure using view_all_notes(), explore_vault(), or list_all_tags() to find relevant notes.

Find the most relevant notes for this task. Remember to call update_selection() after each exploration step!`;
	}
}

// Message template: Final round warning injected before the last iteration
export const SCOUT_FINAL_ROUND_WARNING = `--- FINAL ROUND ---
This is your LAST exploration round. You MUST call update_selection() with confidence: "done".
You may also call record_finding() if needed, but exploration is over.`;

// Message template: Exploration status injected between rounds
export function buildExplorationStatusMessage(iteration: number, maxIterations: number, selectionCount: number | null): string {
	const remainingRounds = maxIterations - iteration;
	return `--- Exploration Status ---
Round ${iteration} of ${maxIterations} complete. ${remainingRounds} round${remainingRounds !== 1 ? 's' : ''} remaining.
Current selection: ${selectionCount !== null ? `${selectionCount} notes` : 'none'}.
---`;
}
