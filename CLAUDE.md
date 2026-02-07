# ObsidianAgent - Developer Reference

## TODO
- [ ] **Saved context presets** — save/load context selection profiles

## Architecture Overview

This is an Obsidian plugin that provides an AI assistant for note editing and answering questions. It uses OpenAI's API (configurable model) and implements a pending edit system where AI-proposed changes are inserted as reviewable blocks.

### Unified Agent

A single agent with a ReAct (Think → Act → Observe) loop explores the vault, searches the web, and takes actions in one unified loop. Replaces the previous 3-phase pipeline (Scout → Web → Task). The agent has **25 tools** across 3 categories:

- **Vault tools** (11): `search_vault`, `read_note`, `list_notes`, `get_links`, `explore_structure`, `list_tags`, `get_manual_context`, `get_properties`, `get_file_info`, `find_dead_links`, `query_notes`
- **Web tools** (2): `web_search`, `read_webpage` (only if search API is configured)
- **Action tools** (12): `edit_note`, `create_note`, `open_note`, `move_note`, `update_properties`, `add_tags`, `link_notes`, `copy_notes`, `delete_note`, `execute_command`, `done`, `ask_user`

**Tool control:**
- `disabledTools: string[]` — single source of truth for which tools are off
- `done` and `ask_user` are always protected (cannot be disabled)
- Default disabled: `['delete_note', 'execute_command']`
- Settings UI uses pill toggles in 4 groups (Vault, Web, Action, Advanced)

**Runaway protection:**
- Hard iteration cap (`agentMaxIterations`, 5-20, default 10)
- Total token budget (`agentMaxTokens`, default 100,000)
- Final round: only `done` + action tools available
- Stuck detection: same tool+args 3x → warning + force finalization
- Cancel button: aborts via AbortSignal after current round

### Scopes
- **Context Scope** (`ContextScopeConfig`): Which notes are sent to AI as manual context
  - `linkDepth` (0-3): How many hops of links to follow
  - Excluded folders act as **walls**: files in them are excluded AND their links are not followed

- **Editable Scope** (`EditableScope`): Which notes AI is allowed to edit
  - `current`: Only current note
  - `linked`: Current + directly linked notes
  - `context`: All context notes

### Capabilities (`AICapabilities`)
- `canAdd`: Allow line insertions
- `canDelete`: Allow replacements and deletions
- `canCreate`: Allow new file creation (derived from `disabledTools`)
- `canNavigate`: Allow opening notes in new tabs (derived from `disabledTools`)

### Settings (`MyPluginSettings`)
- `aiModel`: OpenAI model (gpt-5-mini, gpt-5-nano, gpt-5, gpt-4o, etc.)
- `agentMaxIterations`: Max think-act-observe rounds (5-20, default 10)
- `agentMaxTokens`: Total token budget (default 100,000)
- `chatHistoryLength`: Previous messages to include (0-100, default 10)
- `disabledTools`: Tools turned off by user
- `whitelistedCommands`: Commands the agent can execute
- Web search API settings (openai, serper, brave, tavily)
- Edit rules (scope, capabilities)

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
  customPrompts?: { character?: string };
  chatHistoryLength: number; debugMode: boolean;
}
```

### AgentCallbacks
Bridges pure agent logic to Obsidian APIs:
- **Vault reading**: `readNote`, `searchKeyword`, `searchSemantic`, `listNotes`, `getLinks`, `exploreStructure`, `listTags`, `getAllNotes`, `getManualContext`, `getProperties`, `getFileInfo`, `findDeadLinks`, `queryNotes`
- **Web**: `webSearch?`, `fetchPage?`
- **Actions**: `proposeEdit`, `createNote`, `openNote`, `moveNote`, `updateProperties`, `addTags`, `linkNotes`, `copyNotes`, `deleteNote`, `executeCommand`
- **Meta**: `askUser` (Promise-based pause — blocks the loop until user responds), `onProgress`

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

### main.ts (Obsidian integration, ~4,500 lines)

**MyPlugin**
- `validateEdits()` — validates AI instructions, resolves files, computes new content
- `filterEditsByRulesWithConfig()` — **HARD ENFORCEMENT** of capabilities and editable scope
- `buildContextWithScopeConfig()` — builds manual context string with line numbers
- `getLinkedFilesBFS()` — BFS traversal for multi-depth link resolution

**AIAssistantView**
- `runAgentLoop()` — creates config, calls `runAgent()`, displays results
- `buildAgentCallbacks()` — bridges all 25 agent callbacks to Obsidian APIs
- `showUserClarificationUI()` — Promise-based UI for `ask_user` tool
- `showAgentProgress()` — real-time progress display during agent execution
- `completeAgentProgressFromResult()` — renders detail sections (notes, web, edits) in the progress container
- `renderPendingDeletionBubble()` — confirmation UI for `delete_note` (Accept/Reject)
- `renderCopyNotesBubble()` — copy-to-clipboard UI for `copy_notes`

### src/ai/agent.ts
- `runAgent()` — main ReAct loop engine, dispatches tool calls, tracks tokens
- `ask_user` pauses the loop via Promise (callbacks.askUser) rather than returning early

### src/ai/tools/
- `handleVaultToolCall()` — dispatches vault tool calls via callbacks
- `handleWebToolCall()` — dispatches web tool calls via callbacks
- `handleActionToolCall()` — dispatches action tool calls; `ask_user` calls `callbacks.askUser()` directly, `done` signals completion

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

## Deletion Confirmation

When the agent calls `delete_note`, the file is NOT immediately trashed. Instead a confirmation bubble appears in the chat with "Keep" and "Delete" buttons. The file is only moved to `.trash` when the user clicks Delete.

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
main.ts              - Entry point, plugin lifecycle, UI, callbacks (~4,500 lines)
src/
  types.ts           - Shared type definitions
  ai/
    agent.ts         - Unified Agent ReAct loop engine
    tools/
      vaultTools.ts  - 11 vault exploration tools
      webTools.ts    - 2 web search tools
      actionTools.ts - 12 action tools (edit, create, move, delete, execute, etc.)
    prompts/
      agentPrompts.ts - Agent system prompt builder
      taskPrompts.ts  - Edit rules, scope, position types (reused by agent)
      chatHistory.ts  - Chat history message builder
      index.ts        - Barrel file, shared constants
    context.ts       - Context utilities (addLineNumbers, stripPendingEditBlocks)
    validation.ts    - Edit validation (computeNewContent, determineEditType)
    searchApi.ts     - Web search wrapper (OpenAI, Serper, Brave, Tavily)
    semantic.ts      - Embedding generation and semantic search
    pricing.ts       - Token usage formatting
  edits/
    editManager.ts   - Edit lifecycle management (create/resolve/batch)
    diff.ts          - Diff utilities (computeDiff, LCS)
  modals/
    index.ts         - Modal components (TokenWarning, PendingEdits, ContextPreview, NotePicker)
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
