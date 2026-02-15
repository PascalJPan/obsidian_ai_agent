# Vault Agent - Developer Reference

## TODO
- [ ] **Saved context presets** — save/load context selection profiles

## Architecture Overview

This is an Obsidian plugin that provides an AI assistant for note editing and answering questions. It uses OpenAI's API (configurable model) and implements a pending edit system where AI-proposed changes are inserted as reviewable blocks.

### Unified Agent

A single agent with a ReAct (Think → Act → Observe) loop explores the vault, searches the web, and takes actions in one unified loop. Replaces the previous 3-phase pipeline (Scout → Web → Task). The agent has **35 built-in tools** across 3 categories, plus user-defined **Custom Info Tools**:

- **Vault tools** (19): `search_vault`, `read_note`, `list_notes`, `get_links`, `explore_structure`, `list_tags`, `get_manual_context`, `get_properties`, `get_file_info`, `find_dead_links`, `query_notes`, `get_vault_stats`, `get_chat_history`, `get_note_stats`, `get_note_connections`, `get_selection`, `preview_pending_edits`, `find_orphan_notes`, `find_unlinked_mentions`
- **Web tools** (2): `web_search`, `read_webpage` (only if search API is configured)
- **Action tools** (14): `edit_note`, `create_note`, `open_note`, `move_note`, `update_properties`, `add_tags`, `link_notes`, `copy_notes`, `delete_note`, `execute_command`, `append_to_note`, `search_and_replace`, `done`, `ask_user`
- **Custom Info tools** (0+): User-defined zero-parameter tools that return reference content on demand (e.g., plugin syntax docs). Ships with a **Dataview Reference** tool (`info_dataview_reference`) enabled by default — covers DQL syntax, all 60+ functions, implicit fields, DataviewJS API, and common patterns.

**Tool control:**
- `disabledTools: string[]` — single source of truth for which built-in tools are off
- `done` and `ask_user` are always protected (cannot be disabled)
- Default disabled: `['delete_note', 'execute_command']`
- Custom info tools have per-tool `enabled` toggle (independent of `disabledTools`)
- Settings UI uses pill toggles in 5 groups (Vault, Web, Action, Advanced, Info Tools)

**Runaway protection:**
- Hard iteration cap (`agentMaxIterations`, 5-20, default 10)
- Total token budget (`agentMaxTokens`, default 100,000)
- Final round: only `done` + action tools available
- Stuck detection: same tool+args 3x → warning + force finalization; tool-name-only frequency ≥8 → secondary warning
- Cancel button: aborts via AbortSignal after current round
- API retry: transient failures (429/5xx) retried up to 2x with exponential backoff
- Custom info tool results truncated at 32K chars to prevent token budget exhaustion
- `parallel_tool_calls: false` to prevent stale line numbers from concurrent edits

### Scopes
- **Context Scope** (`ContextScopeConfig`): Which notes are sent to AI as manual context
  - `linkDepth` (0-3): How many hops of links to follow
  - Excluded folders act as **walls**: files in them are excluded AND their links are not followed
  - `excludedTag` (default `"private"`): notes with this tag are treated as excluded (same enforcement as folders)

- **Editable Scope** (`EditableScope`): Which notes AI is allowed to edit
  - `current`: Only current note
  - `vault`: Any note in the vault

### Capabilities (`AICapabilities`)
- `canAdd`: Allow line insertions
- `canDelete`: Allow replacements and deletions
- `canCreate`: Allow new file creation (derived from `disabledTools`)
- `canNavigate`: Allow opening notes in new tabs (derived from `disabledTools`)

### Settings (`MyPluginSettings`)
- **Core**: `aiModel`, `openaiApiKey`, `customInstructions`, `pendingEditTag`
- **Agent**: `agentMaxIterations` (5-20, default 10), `agentMaxTokens` (default 100,000), `chatHistoryLength` (0-100, default 10 — slim Q&A window; full details via `get_chat_history` tool)
- **Context defaults**: `defaultLinkDepth`, `defaultMaxLinkedNotes`, `defaultMaxFolderNotes`, `defaultSemanticMatchCount`, `defaultSemanticMinSimilarity`
- **Edit defaults**: `defaultEditableScope`, `defaultCanAdd`, `defaultCanDelete`
- **Tool control**: `disabledTools`, `whitelistedCommands`, `customInfoTools`, `customModelPricing` ($/1M tokens, sparse — only edited models stored)
- **Privacy**: `excludedFolders`, `excludedTag` (default `"private"`)
- **Web search**: `webAgentSearchApi` (openai, serper, brave, tavily), `webAgentSearchApiKey`, `webAgentSnippetLimit`, `webAgentFetchLimit`, `webAgentTokenBudget`
- **Feature toggles**: `enableWebSearch`, `enableEmbeddings`, `enableManualContext` (all default `false`)
- **UI**: `debugMode`, `clearChatOnNoteSwitch`, `showTokenUsage`, `embeddingModel`
- **Internal**: `_defaultInfoToolsVersion`

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

### CustomInfoTool
```typescript
interface CustomInfoTool {
  id: string;                  // UUID
  name: string;                // User-facing name, e.g. "Dataview Syntax"
  toolName: string;            // Auto-generated, e.g. "info_dataview_syntax"
  triggerDescription: string;  // AI sees this as the tool description
  contentType: 'inline' | 'note';
  inlineContent?: string;      // Content if inline
  notePath?: string;           // Vault note path if note-based
  enabled: boolean;            // Per-tool toggle
}
```

### AgentConfig
```typescript
interface AgentConfig {
  model: string; apiKey: string;
  capabilities: AICapabilities; editableScope: EditableScope;
  maxIterations: number;  // 5-20, default 10
  maxTotalTokens: number; // token budget across all rounds
  webEnabled: boolean;
  disabledTools: string[];
  whitelistedCommands: WhitelistedCommand[];
  customInfoTools: CustomInfoTool[];
  customPrompts?: { character?: string };
  chatHistoryLength: number; debugMode: boolean;
  webSearchApi?: SearchApiType;
  webSearchApiKey?: string;
  webSnippetLimit?: number;
  webFetchLimit?: number;
  webTokenBudget?: number;
}
```

### AgentCallbacks
Bridges pure agent logic to Obsidian APIs. Built via `buildAgentCallbacks(snapshotActiveFile)` — active file is captured once at agent start and closed over to prevent race conditions if user navigates during execution.
- **Vault reading**: `readNote`, `searchKeyword`, `searchSemantic`, `listNotes`, `getLinks`, `exploreStructure`, `listTags`, `getAllNotes`, `getManualContext`, `getProperties`, `getFileInfo`, `findDeadLinks`, `queryNotes`, `getVaultStats?`, `getChatHistory?`, `getNoteStats?`, `getNoteConnections?`, `getSelection?`, `previewPendingEdits?`, `findOrphanNotes?`, `findUnlinkedMentions?`
- **Web**: `webSearch?`, `fetchPage?`
- **Actions**: `proposeEdit`, `createNote`, `openNote`, `moveNote`, `updateProperties`, `addTags`, `linkNotes`, `copyNotes`, `deleteNote` (returns `pending: true`), `executeCommand`, `searchAndReplace?`
- **Custom Info**: `resolveCustomInfoTool?` — resolves inline content or reads vault note for custom info tools
- **Meta**: `askUser` (Promise-based pause — blocks the loop until user responds, 2min timeout), `onProgress`

**`findNoteByAnyName`** resolves paths through: exact path → suffix match → filename → basename. Throws an error when multiple files match at any level (ambiguity), which `safeFindNote()` wrapper catches and converts to error messages.

### AgentResult
```typescript
interface AgentResult {
  success: boolean; summary: string;
  editsProposed: EditInstruction[]; notesRead: string[];
  notesCopied: string[];
  webSourcesUsed: WebSource[];
  tokenUsage: { total: number; promptTokens: number; completionTokens: number; perRound: number[] };
  iterationsUsed: number;
  error?: string;
}
```

## Position Types
- `start` / `end` — beginning/end of file
- `after:## Heading` — after a specific heading
- `insert:N` — insert before line N
- `replace:N` or `replace:N-M` — replace line(s)
- `delete:N` or `delete:N-M` — delete line(s)
- `create` — create new file
- `open` — open note in new tab (navigation, no content change)

## Key Methods

### main.ts (Obsidian integration, ~5,700 lines)

**MyPlugin**
- `validateEdits()` — validates AI instructions, resolves files, computes new content
- `filterEditsByRulesWithConfig()` — **HARD ENFORCEMENT** of capabilities and editable scope
- `buildContextWithScopeConfig()` — builds manual context string with line numbers
- `getLinkedFilesBFS()` — BFS traversal for multi-depth link resolution

**AIAssistantView**
- `runAgentLoop()` — creates config, calls `runAgent()`, displays results
- `buildAgentCallbacks(snapshotActiveFile)` — bridges all 32 agent callbacks to Obsidian APIs; captures active file at start
- `showUserClarificationUI()` — Promise-based UI for `ask_user` tool
- `showAgentProgress()` — real-time progress display during agent execution
- `completeAgentProgressFromResult()` — renders detail sections (notes, web, edits) in the progress container
- `renderPendingDeletionBubble()` — confirmation UI for `delete_note` (Keep/Delete)
- `renderPendingMoveBubble()` — undo/keep UI for `move_note`
- `renderPendingPropertiesBubble()` — undo/keep UI for `update_properties`
- `renderPendingTagsBubble()` — undo/keep UI for `add_tags`
- `renderCopyNotesBubble()` — copy-to-clipboard UI for `copy_notes`

### src/ai/agent.ts
- `runAgent()` — main ReAct loop engine, dispatches tool calls, tracks tokens
- `ask_user` pauses the loop via Promise (callbacks.askUser) rather than returning early

### src/ai/tools/
- `handleVaultToolCall()` — dispatches vault tool calls via callbacks
- `handleWebToolCall()` — dispatches web tool calls via callbacks
- `handleActionToolCall()` — dispatches action tool calls; `ask_user` calls `callbacks.askUser()` directly, `done` signals completion
- `buildCustomInfoTools()` — builds zero-parameter OpenAI tool definitions from enabled custom info tools

### src/ai/prompts/
- `buildAgentSystemPrompt()` — builds system prompt with vault language, tools, scope rules
- `buildScopeInstruction()` / `buildEditRules()` / `buildForbiddenActions()` — reused from taskPrompts
- `buildMessagesFromHistory()` — chat history with rich edit context

### src/ai/validation.ts
- `computeNewContent()` — applies position-based edit to content string
- `determineEditType()` — infers edit type from position

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

## Action Confirmation / Undo System

Several action tools produce reviewable confirmation bubbles in the chat:

- **`delete_note`**: "Keep" / "Delete" buttons. File is only moved to `.trash` when the user clicks Delete.
- **`move_note`**: "Keep" / "Undo" buttons. Move is applied immediately; Undo reverts the rename (restoring original folder if needed).
- **`update_properties`**: "Keep" / "Undo" buttons. Previous property values are snapshotted before applying; Undo restores them.
- **`add_tags`**: "Keep" / "Undo" buttons. Previous tags array is snapshotted; Undo restores the original tags.
- **`link_notes`**: Now routes through the pending edit system (inline accept/reject widget in the note) instead of writing directly.

## Chat UX

- **User messages**: text wrapped in `<span>` for proper selection in Electron
- **Typing while loading**: textarea stays enabled during agent execution; submit is blocked until agent completes
- **Detail toggles** (notes accessed, web sources, edits): rendered inside the agent progress container ("Agent complete" box), not in the response bubble
- **Manual context toggle**: smaller font (0.75em) in the bottom section

## Build Commands
```bash
npm run dev    # Watch mode
npm run build  # Production build (tsc + esbuild)
```

## File Structure
```
main.ts              - Entry point, plugin lifecycle, UI, callbacks (~5,700 lines)
src/
  types.ts           - Shared type definitions
  ai/
    agent.ts         - Unified Agent ReAct loop engine
    tools/
      vaultTools.ts  - 19 vault exploration tools (includes get_selection, preview_pending_edits, find_orphan_notes, find_unlinked_mentions)
      webTools.ts    - 2 web search tools
      actionTools.ts - 14 action tools (edit, create, move, delete, execute, append, search_and_replace, etc.)
    prompts/
      agentPrompts.ts - Agent system prompt builder
      taskPrompts.ts  - Edit rules, scope, position types (reused by agent)
      chatHistory.ts  - Chat history message builder
      index.ts        - Barrel file, shared constants
    context.ts       - Context utilities (addLineNumbers, stripPendingEditBlocks)
    validation.ts    - Edit validation (computeNewContent, determineEditType)
    searchApi.ts     - Web search wrapper (OpenAI, Serper, Brave, Tavily)
    semantic.ts      - Embedding generation and semantic search
    pricing.ts       - Token usage formatting (supports custom pricing overrides)
  edits/
    editManager.ts   - Edit lifecycle management (create/resolve/batch)
    diff.ts          - Diff utilities (computeDiff, LCS)
  modals/
    index.ts         - Modal components (TokenWarning, PendingEdits, ContextPreview, NotePicker)
  defaults/
    dataviewReference.ts - Default Dataview Reference info tool (shipped built-in)
    defaultInstructions.ts - Default custom instructions for new installations
  utils/
    logger.ts        - Structured logging with categories
    fileUtils.ts     - File exclusion utilities
styles.css           - Widget and view styling
manifest.json        - Plugin metadata
```

## Chat History & AI Memory

When `chatHistoryLength > 0`, the AI receives rich context about previous interactions:

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  type?: 'message' | 'context-switch';
  activeFile?: string;
  proposedEdits?: EditInstruction[];
  editResults?: { success: number; failed: number; failures: Array<{ file: string; error: string }> };
  tokenUsage?: TokenUsage;
  model?: string;
  webSources?: WebSource[];
}
```
