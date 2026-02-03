# ObsidianAgent - Developer Reference

## TODO

### Completed
- [x] Fix the "current note only" selection as other notes still receive edits even when it is clicked. Make it not prompt dependent (enforce in validation, not just AI instructions). **DONE**: Implemented `filterEditsByRules()` for hard enforcement.
- [x] Modular architecture refactor - Split monolithic `main.ts` into focused modules
- [x] **UI Polish** - Clear chat icon (eraser), pending edit widget styling, keyboard shortcuts
- [x] **Token count display** - Show actual token usage and cost in chat messages
- [x] **Debug output readability** - Debug mode now outputs readable JSON text instead of objects
- [x] **JSON parse bug fix** - Fixed parsing failure when AI response content contained markdown code blocks
- [x] **Context selection UI refactor** - Replaced radio buttons with link depth slider (0-3) and independent "Same Folder" checkbox. BFS traversal for multi-depth links where excluded folders act as walls.
- [x] **Agentic mode exploration improvements** - Complete rewrite of context agent:
  - Running selection approach (`update_selection` tool) instead of fallback scoring
  - New tools: `search_keyword`, `search_task_relevant`, `get_links_recursive`
  - Improved system prompt with multi-hop exploration guidance
  - Default iterations increased to 3, slider range 2-5
  - Parallel tool calls enabled for efficiency
  - `agenticKeywordLimit` setting (3-20) for keyword search results
- [x] **Token limit enforcement** - Renamed `tokenWarningThreshold` to `taskAgentTokenLimit`:
  - Now a hard limit, not just a warning
  - Removes notes by priority when limit exceeded (manual → semantic → folder → linked → current)
  - Shows toast notification when notes are removed
  - Minimum token limit validation (3000)
- [x] **Default link depth** - Changed from 1 to 2
- [x] **Live sync settings** - Settings changes now immediately update view sliders
- [x] **Plugin rename** - Renamed from "AI Assistant" / "sample-plugin" to "ObsidianAgent" throughout codebase

### Context Selection Improvements
- [x] **Add notes individually** - Picker UI implemented for manually adding notes to context
- [ ] Consider saved context presets/profiles

### Future Enhancements
- [ ] **Full Orchestrator Agent** - Meta-agent that routes tasks (partial: PipelineContext done)
  - Owns chat history, sends only relevant context to each agent
  - Classifies task type and selects which agents to run
  - Enables multi-round orchestration (Web → Scout → Edit)
- [ ] **Saved context presets** - Save/load context selection profiles

### UI/UX Improvements
- [x] **Move edit options to settings** - Moved edit rules toggle from chat tab to Obsidian settings panel

### Agentic Mode Enhancements
- [x] **Web Agent** - Modular web search pipeline phase (Scout → Web → Task)
- [x] **View all note names** - `view_all_notes` tool lists all note names with alias/description from YAML frontmatter
- [x] **Vault exploration tool** - `explore_vault` tool for listing folder contents or finding notes by tag
- [x] **Open note capability** - `canNavigate` capability allows AI to open notes in new tabs via `open` position
- [x] **Agentic iterations slider** - Increased max to 10, changed default to 5
- [x] **Expected tokens display** - Shows max expected tokens in scout agent settings
- [x] **Max notes to select** - Increased max from 20 to 50 (default stays at 20)
- [x] **Edit rules defaults** - Changed defaults: scope=context, all capabilities enabled
- [x] **Send button centering** - Centered send button vertically in chat input box
- [x] **Scout agent tool configuration** - Settings UI for enabling/disabling individual scout tools
- [x] **Vault tags visibility** - Checkbox for showing all vault tags to AI
- [x] **Agent Toggle Buttons** - Replaced Focused/Agentic radio with 3 independent agent toggles (Scout, Web, Task):
  - Each agent can be enabled/disabled independently
  - All agents off → send button disabled
  - Toggle states persist across sessions
  - Default: Scout OFF, Web OFF, Task ON
  - Copy button in Scout results to copy all selected note contents
- [x] **Pipeline Context** - Task Agent now understands WHY notes were selected:
  - `PipelineContext` object accumulates metadata across phases
  - Scout metadata: per-note selection reason, semantic scores, keyword match types, link depths
  - Web metadata: search queries attempted, evaluation reasoning
  - Task Agent system prompt includes "Prior Agent Context" section
- [x] **Scout Agent Enhancements**:
  - New `list_all_tags` tool - Discover all tags in vault with counts
  - New `ask_user` tool - Ask clarifying questions with pause/resume support
  - Removed `recommendedMode` - Task Agent determines mode from task
  - Added exploration summary tracking
  - Improved prompts with "fetch before select" guidance
- [x] **Unified Context Builder** - New `src/ai/contextBuilder.ts`:
  - `buildUnifiedContext()` consolidates context building
  - Per-note metadata annotations (semantic %, keyword match type)
  - Token limit enforcement with priority-based removal

## Architecture Overview

This is an Obsidian plugin that provides an agentic AI assistant for note editing and answering questions. It uses OpenAI's API (configurable model) and implements a pending edit system where AI-proposed changes are inserted as reviewable blocks.

## Key Concepts

### Agent Toggles (`AgentToggles`)
Three independent agent toggles control the execution pipeline:
- **Scout Agent** (`scout`): Explores vault to find relevant context. When OFF, uses manual context selection.
- **Web Agent** (`web`): Searches the web for external information.
- **Task Agent** (`task`): Executes the actual task (answer questions or propose edits).

Default: Scout OFF, Web OFF, Task ON. At least one agent must be enabled to send a message.

### Scopes
- **Context Scope** (`ContextScopeConfig`): Which notes are sent to AI as context
  - `linkDepth` (0-3): Controls how many hops of links to follow
    - 0: Current note only
    - 1: Direct links (outgoing + backlinks)
    - 2-3: Links of links (BFS traversal)
  - `includeSameFolder`: Additive checkbox to include all notes in same folder
  - Excluded folders act as **walls**: files in them are excluded AND their links are not followed
  - Legacy `ContextScope` type still supported for backwards compatibility

- **Editable Scope** (`EditableScope`): Which notes AI is allowed to edit
  - `current`: Only current note
  - `linked`: Current + directly linked notes
  - `context`: All context notes

### Capabilities (`AICapabilities`)
- `canAdd`: Allow line insertions
- `canDelete`: Allow replacements and deletions
- `canCreate`: Allow new file creation
- `canNavigate`: Allow opening notes in new tabs (executes immediately, not as pending edit)

### Settings (`MyPluginSettings`)
- `aiModel`: OpenAI model to use (gpt-5-mini, gpt-5-nano, gpt-5, gpt-4o, etc.)
- `chatHistoryLength`: Number of previous messages to include (0-100, default 10)

## Core Data Structures

### EditInstruction (from AI)
```typescript
{ file: string, position: string, content: string }
```

### ValidatedEdit (internal)
Wraps EditInstruction with resolved file, current/new content, and error state.

### InlineEdit (stored in notes)
```typescript
{ id: string, type: 'replace'|'add'|'delete', before: string, after: string }
```

## Position Types
- `start` / `end` - Beginning/end of file
- `after:## Heading` - After a specific heading
- `insert:N` - Insert before line N
- `replace:N` or `replace:N-M` - Replace line(s)
- `delete:N` or `delete:N-M` - Delete line(s)
- `create` - Create new file
- `open` - Open note in new tab (navigation, no content change)

## Key Methods

### main.ts (Obsidian integration, state management)

**MyPlugin**
- `insertEditBlocks()` - Batches edits by file, processes bottom-to-top to prevent line shift issues
- `applyEditBlockToContent()` - Applies edit block to content string in memory
- `resolveEdit()` - Accepts/rejects a pending edit
- `validateEdits()` - Validates AI instructions, resolves files, computes new content
- `filterEditsByRulesWithConfig()` - **HARD ENFORCEMENT**: Validates edits against capabilities and editable scope
- `getEditableFilesWithConfig()` - Returns set of file paths allowed for editing based on scope config
- `buildContextWithScopeConfig()` - Builds context string with line numbers using new config
- `getLinkedFilesBFS()` - BFS traversal for multi-depth link resolution (excluded folders = walls)
- `getSameFolderFiles()` - Gets all non-excluded files in same folder
- `normalizeContextScope()` - Converts legacy `ContextScope` to new `ContextScopeConfig`

**AIAssistantView**
- `handleEditMode()` - Orchestrates Task Agent: calls agent → validates → filters → inserts blocks
- `buildMessagesWithHistory()` - Builds API messages array with rich chat history context

### src/ai/prompts.ts (pure functions)
- `buildScopeInstruction()` - Generates scope rules text
- `buildPositionTypes()` - Generates position types based on capabilities
- `buildEditRules()` - Generates general edit rules
- `buildForbiddenActions()` - Generates explicit warnings for disabled capabilities

### src/ai/taskAgent.ts (Task Agent)
- `runTaskAgent()` - Main entry point for Phase 3 (answer or edit)
- `buildTaskAgentSystemPrompt()` - Constructs system prompt with dynamic rules
- `buildMessagesFromHistory()` - Builds messages array with chat history
- `parseAIEditResponse()` - Parses JSON response from AI

### src/ai/validation.ts (pure functions)
- `computeNewContent()` - Applies position-based edit to content string
- `determineEditType()` - Infers edit type (add/replace/delete) from position
- `escapeRegex()` - Escapes special regex characters

### src/ai/context.ts (pure functions)
- `addLineNumbers()` - Prepends line numbers to content

### src/edits/diff.ts (pure functions)
- `computeDiff()` - Computes line-by-line diff between two strings
- `longestCommonSubsequence()` - LCS algorithm for diff computation

## Chat History & AI Memory

When `chatHistoryLength > 0`, the AI receives rich context about previous interactions:

### ChatMessage Extended Fields
```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  activeFile?: string;           // Which file user was viewing
  proposedEdits?: EditInstruction[];  // Edits AI proposed
  editResults?: {                // What succeeded/failed
    success: number;
    failed: number;
    failures: Array<{ file: string; error: string }>;
  };
}
```

### What AI Knows From History
- Which file the user was viewing for each message
- Exactly what edits it proposed (file, position, content)
- What succeeded and what failed with specific error messages
- How pending edit blocks look (can modify its own pending edits)

## Hard Enforcement System

Edit rules are enforced at two levels:
1. **Soft (prompts)**: AI is instructed about rules via `buildForbiddenActions()`
2. **Hard (validation)**: `filterEditsByRules()` rejects non-compliant edits AFTER AI response

This ensures rules are enforced even if AI ignores instructions.

## Pending Edit System

Edit blocks are stored as fenced code blocks in notes:
```
```ai-edit
{"id":"abc123","type":"add","before":"","after":"new content"}
```
#ai_edit
```

Users see a widget with Accept/Reject buttons. The tag (`#ai_edit`) enables searchability.

## Build Commands
```bash
npm run dev    # Watch mode
npm run build  # Production build
```

## File Structure
```
main.ts              - Entry point, plugin lifecycle, UI classes
src/
  types.ts           - Shared type definitions (PipelineContext, NoteSelectionMetadata, etc.)
  ai/
    context.ts       - Context utilities (addLineNumbers)
    contextBuilder.ts - Unified context builder with metadata annotations
    contextAgent.ts  - Agentic mode Phase 1: vault exploration agent (Scout Agent)
    webAgent.ts      - Agentic mode Phase 2: web research agent (Web Agent)
    taskAgent.ts     - Agentic mode Phase 3: answer/edit execution (Task Agent)
    searchApi.ts     - Search API wrapper (OpenAI, Serper, Brave, Tavily) + page fetcher
    prompts.ts       - Prompt constants and builders
    validation.ts    - Edit validation (computeNewContent, determineEditType, escapeRegex)
    semantic.ts      - Embedding generation and semantic search
  edits/
    diff.ts          - Diff utilities (computeDiff, longestCommonSubsequence)
styles.css           - Widget and view styling
manifest.json        - Plugin metadata
```

## Agentic Mode (Context Agent)

The agentic mode uses a two-phase approach:

### Phase 1: Context Agent (`contextAgent.ts`)
An AI agent that explores the vault to find relevant notes for the user's task.

**Tools available to the agent:**
- `update_selection` - Maintains running selection with reasoning + confidence level
- `list_notes` - List notes with previews (filterable by folder)
- `search_keyword` - Fast keyword search with priority: title > heading > content (tracks match types)
- `search_semantic` - Embedding-based semantic similarity search (tracks scores)
- `search_task_relevant` - Task-aware semantic search (combines task + current note context)
- `fetch_note` - Get full content of a specific note
- `get_links` - Get direct links (in/out/both) from a note
- `get_links_recursive` - BFS traversal for multi-hop link exploration (depth 1-3, tracks depths)
- `view_all_notes` - List ALL note names with aliases/descriptions from YAML frontmatter
- `explore_vault` - Explore vault structure: list folder contents or find notes by tag
- `list_all_tags` - List all tags in vault with note counts
- `ask_user` - Ask clarifying questions (pauses execution, resumes after user response)

**Running Selection Pattern:**
- Agent calls `update_selection()` after each exploration step
- Selection includes: selectedPaths, reasoning, confidence ('exploring'|'confident'|'done')
- If agent sets confidence: 'done', exploration ends early
- On timeout: uses the last selection (never falls back to arbitrary scoring)
- Metadata tracked: semantic scores, keyword match types, link depths per note

**Settings:**
- `agenticMaxIterations` (2-5, default 3): Max exploration rounds
- `agenticMaxNotes` (3-20, default 10): Max notes to select
- `agenticKeywordLimit` (3-20, default 10): Max keyword search results
- `agenticScoutModel`: Model for exploration (default: same as main model)

### Phase 2: Web Agent (`webAgent.ts`)
An optional AI agent that searches the web for external information when vault context is insufficient.

**Flow:**
1. EVALUATE: Determine if vault context can fully answer the task
2. FORMULATE: Create optimized search query
3. SEARCH: Get search results from API (OpenAI, Serper, Brave, or Tavily)
4. SELECT: Choose which URLs to fetch in full
5. FETCH: Get full page content with token budget
6. EXTRACT: Pull relevant information

**Tools available to the agent:**
- `evaluate_context` - Determine if vault context is sufficient or web search needed
- `web_search` - Search the web using configured API
- `select_pages` - Choose which search results to fetch in full
- `finalize_web_context` - Complete research and compile findings

**Settings:**
- `webAgentEnabled`: Master toggle (default: false, opt-in)
- `webAgentSearchApi`: Which search API to use (openai, serper, brave, tavily)
- `webAgentSearchApiKey`: API key for search service (not needed for OpenAI - uses main API key)
- `webAgentSnippetLimit` (3-15, default 8): Max search results
- `webAgentFetchLimit` (1-5, default 3): Max pages to fetch in full
- `webAgentTokenBudget` (2000-20000, default 8000): Max tokens for web content
- `webAgentAutoSearch`: Automatically search when needed (default: true)

### Phase 3: Task Agent (`taskAgent.ts`)
Uses the context gathered in Phase 1 and 2 to execute the actual task.

**Entry Function:**
```typescript
export async function runTaskAgent(
  input: TaskAgentInput,
  config: TaskAgentConfig,
  logger?: Logger,
  onProgress?: (event: AgentProgressEvent) => void
): Promise<TaskAgentResult>
```

**Input:** Task string, context (formatted notes), chat history, optional web sources, pipeline context
**Output:** Success flag, edits array (if any), summary text, token usage

**Behavior:**
- Builds system prompt with capabilities and scope rules
- Includes "Prior Agent Context" section from PipelineContext:
  - Scout: confidence, reasoning, high-relevance notes with scores
  - Web: search queries, evaluation reasoning
- Includes chat history for multi-turn conversations
- Calls OpenAI API with JSON response format
- Returns structured result for validation/insertion by main.ts

The Task Agent decides whether to answer a question (empty edits) or propose changes (edits array) based on the user's request.

### Pipeline Context (`PipelineContext`)
Accumulates metadata across phases for Task Agent awareness:
```typescript
interface PipelineContext {
  scout?: {
    selectedNotes: NoteSelectionMetadata[];  // Per-note metadata
    reasoning: string;
    confidence: 'exploring' | 'confident' | 'done';
    explorationSummary: string;
    tokensUsed: number;
  };
  web?: {
    searchPerformed: boolean;
    evaluationReasoning?: string;
    searchQueries: string[];
    sources: EnhancedWebSource[];
    tokensUsed: number;
  };
  tokenAccounting: { scoutTokens, webTokens, taskTokens, totalTokens };
}
```
