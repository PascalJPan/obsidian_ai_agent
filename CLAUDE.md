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
- [x] **Token limit enforcement** - Renamed `tokenWarningThreshold` to `answerEditTokenLimit`:
  - Now a hard limit, not just a warning
  - Removes notes by priority when limit exceeded (manual → semantic → folder → linked → current)
  - Shows toast notification when notes are removed
  - Minimum token limit validation (3000)
- [x] **Default link depth** - Changed from 1 to 2
- [x] **Live sync settings** - Settings changes now immediately update view sliders
- [x] **Plugin rename** - Renamed from "AI Assistant" / "sample-plugin" to "ObsidianAgent" throughout codebase

### Security & Validation
- [ ] Audit prompt injection defenses (notes treated as data, not instructions)
- [ ] Review excluded folder enforcement
- [ ] Validate API key handling security

### Prompt Optimization
- [ ] Analyze prompt token efficiency
- [ ] Test prompt clarity with different models
- [ ] Consider prompt caching strategies

### Observability & Debugging
- [ ] Add structured logging for edit pipeline
- [ ] Consider telemetry for edit success/failure rates

### Context Selection Improvements
- [x] **Link depth slider** - 0-3 depth slider for multi-hop link traversal (BFS algorithm)
- [x] **Same folder checkbox** - Independent, additive folder inclusion
- [x] **Excluded folders as walls** - Excluded folders block traversal, not just exclusion
- [ ] **Versatile context selection** - Additional options:
  - View all note names with alias/description fields from YAML frontmatter
  - Add notes individually to context (picker UI)
  - Checkbox for whether all vault tags are visible to AI
- [ ] Consider saved context presets/profiles

### UI/UX Improvements
- [ ] **Mode-specific toggle visibility**:
  - Hide context notes toggle in agentic mode (not used - agent selects context dynamically)
  - Hide edit rules toggle in Q&A mode (not used - no edits happen)
- [ ] **Scout Agent settings panel**: In agentic mode, add a "Scout Agent" toggle/section with sliders:
  - Max exploration rounds
  - Max send tokens per round
  - Max notes selected
- [ ] **Remove sub-mode toggle in agentic mode**: Instead of Q&A/Edit toggle in agentic mode, let the scout agent's first iteration decide whether to use edit or Q&A mode for Phase 2
- [ ] **Settings layout cleanup**: Reorganize settings for better intuitiveness without changing functionality
- [x] ~~**Token warning threshold behavior**~~ - Replaced with hard token limit enforcement (see Completed section)

### Agentic Mode Enhancements
- [ ] **Web search tool** - Add web search capability to agentic AI
- [ ] **Vault metadata tool** - Single tool with 3 modes for agent to query:
  - Get folder structure of vault
  - Get all tags used in vault
  - Get all note names in vault
- [ ] **Open note tool** - Agent can open/navigate to a specific note it has seen or thinks exists
- [ ] **Agentic iterations slider** - Increase max to 10, change default to 5
- [ ] **Expected tokens display** - Show max expected tokens next to scout agent settings:
  - Formula: (max tokens per iteration × exploration rounds) + answer/edit token limit
- [ ] **Agent note switching** - Agent can change which note user is viewing (switch to another note)
- [ ] **Max notes to select** - Increase max from 20 to 50 (default stays at 20)
- [ ] **Edit rules defaults** - Change defaults:
  - Editable scope: all context notes (instead of current only)
  - All capabilities enabled by default (canAdd, canDelete, canCreate)
- [ ] **Send button centering** - Center send button vertically in the middle of the chat input box height

### Future Features
- [ ] Support for other AI providers (Anthropic, local models)
- [ ] Streaming responses
- [ ] Edit preview modal before insertion

## Architecture Overview

This is an Obsidian plugin that provides an agentic AI assistant for note editing and Q&A. It uses OpenAI's API (configurable model) and implements a pending edit system where AI-proposed changes are inserted as reviewable blocks.

## Key Concepts

### Modes
- **Q&A Mode**: Simple question answering based on note context
- **Edit Mode**: AI proposes structured edits as JSON, which get converted to pending edit blocks

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

### Settings (`MyPluginSettings`)
- `aiModel`: OpenAI model to use (gpt-4o-mini, gpt-4o, gpt-4-turbo, etc.)
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
- `handleEditMode()` - Orchestrates edit flow: API call → parse → validate → filter → insert blocks
- `handleQAMode()` - Simple Q&A flow
- `buildMessagesWithHistory()` - Builds API messages array with rich chat history context

### src/ai/prompts.ts (pure functions)
- `buildEditSystemPrompt()` - Constructs system prompt with dynamic rules
- `buildForbiddenActions()` - Generates explicit warnings for disabled capabilities
- `buildQASystemPrompt()` - Constructs system prompt for Q&A mode

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
  types.ts           - Shared type definitions
  ai/
    context.ts       - Context utilities (addLineNumbers)
    contextAgent.ts  - Agentic mode Phase 1: vault exploration agent
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
- `search_keyword` - Fast keyword search with priority: title > heading > content
- `search_semantic` - Embedding-based semantic similarity search
- `search_task_relevant` - Task-aware semantic search (combines task + current note context)
- `fetch_note` - Get full content of a specific note
- `get_links` - Get direct links (in/out/both) from a note
- `get_links_recursive` - BFS traversal for multi-hop link exploration (depth 1-3)

**Running Selection Pattern:**
- Agent calls `update_selection()` after each exploration step
- Selection includes: selectedPaths, reasoning, confidence ('exploring'|'confident'|'done')
- If agent sets confidence: 'done', exploration ends early
- On timeout: uses the last selection (never falls back to arbitrary scoring)

**Settings:**
- `agenticMaxIterations` (2-5, default 3): Max exploration rounds
- `agenticMaxNotes` (3-20, default 10): Max notes to select
- `agenticKeywordLimit` (3-20, default 10): Max keyword search results
- `agenticScoutModel`: Model for exploration (default: same as main model)

### Phase 2: Task Agent
Uses the context gathered in Phase 1 to execute the actual task (Q&A or Edit mode).
