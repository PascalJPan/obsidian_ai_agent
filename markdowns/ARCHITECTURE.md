# ObsidianAgent — Architecture

## Overview

Single unified **Agent** with a ReAct (Think → Act → Observe) loop that explores the vault, searches the web, and takes actions — all in one loop. Replaces the previous 3-phase pipeline (Scout → Web → Task).

```
User Message + Minimal Context (current note if open, vault stats)
       ↓
 ┌─── Agent ReAct Loop ────┐
 │  Think → Call Tool(s)    │
 │  Observe → Think Again   │
 │  Ready? → Act & Done     │
 │                          │
 │  25 tools:               │
 │  11 vault, 2 web,        │
 │  12 actions              │
 └──────────────────────────┘
       ↓
 Edits live + Summary + Copy button
```

## Entry Point
- `main.ts` (~4,500 lines)
  - Obsidian plugin lifecycle (onload, commands, views)
  - `AIAssistantView` — sidebar chat UI
  - `buildAgentCallbacks()` — bridges agent to Obsidian APIs
  - `runAgentLoop()` — creates config, calls `runAgent()`, displays results
  - Settings tab (`AIAssistantSettingTab`) with pill toggles for tool control

## Agent Core
- `src/ai/agent.ts`
  - `runAgent()` — main ReAct loop engine
  - Pure TypeScript + `requestUrl` (minimal Obsidian dependency)
  - Dispatches tool calls to handlers via callbacks
  - `ask_user` pauses the loop via Promise (callbacks.askUser) — no early-return
  - Runaway protection: iteration cap, token budget, stuck detection, AbortSignal

## Tools (3 files, 25 total)
- `src/ai/tools/vaultTools.ts` — 11 vault exploration tools
  - `search_vault` (keyword/semantic/both), `read_note`, `list_notes`
  - `get_links`, `explore_structure`, `list_tags`, `get_manual_context`
  - `get_properties`, `get_file_info`, `find_dead_links`, `query_notes`
- `src/ai/tools/webTools.ts` — 2 web tools
  - `web_search`, `read_webpage`
- `src/ai/tools/actionTools.ts` — 12 action tools
  - `edit_note`, `create_note`, `open_note`, `move_note`
  - `update_properties`, `add_tags`, `link_notes`, `copy_notes`
  - `delete_note`, `execute_command`
  - `done`, `ask_user`

### Tool Control
- `disabledTools: string[]` — single source of truth for which tools are off
- `done` and `ask_user` are always protected (cannot be disabled)
- Default disabled: `['delete_note', 'execute_command']`
- Settings UI uses pill toggles in 4 groups (Vault, Web, Action, Advanced)
- Disabled tools are also rejected at runtime if the API hallucinates them

## Prompts
- `src/ai/prompts/agentPrompts.ts` — agent system prompt builder
- `src/ai/prompts/taskPrompts.ts` — edit rules, scope, position types (reused by agent)
- `src/ai/prompts/chatHistory.ts` — chat history message builder
- `src/ai/prompts/index.ts` — barrel file, shared constants

## AI Utilities
- `src/ai/context.ts` — `addLineNumbers()`, `stripPendingEditBlocks()`
- `src/ai/validation.ts` — `computeNewContent()`, `determineEditType()`
- `src/ai/searchApi.ts` — web search wrapper (OpenAI, Serper, Brave, Tavily)
- `src/ai/semantic.ts` — embedding generation and semantic search
- `src/ai/pricing.ts` — token usage formatting

## Edit Handling
- `src/edits/editManager.ts` — pending edit blocks lifecycle (create, resolve, batch)
- `src/edits/diff.ts` — diff computation for previews

## UI
- `src/modals/index.ts` — TokenWarningModal, PendingEditsModal, ContextPreviewModal, NotePickerModal

### Chat UI Components
- **Agent progress container**: shows real-time tool calls during execution; on completion, displays detail toggles (notes accessed, web sources, edits)
- **Pending deletion bubble**: confirmation UI for `delete_note` with Keep/Delete buttons
- **Copy notes bubble**: clipboard UI for `copy_notes` with collapsible note list
- **Clarification UI**: interactive question/answer for `ask_user` with optional choice buttons
- **User messages**: text wrapped in `<span>` for proper selection in Electron
- **Input**: textarea stays enabled during agent execution (submit blocked until done)

## Types
- `src/types.ts` — all shared interfaces
  - `AgentConfig`, `AgentCallbacks`, `AgentInput`, `AgentResult`
  - `EditInstruction`, `ValidatedEdit`, `InlineEdit`
  - `AICapabilities`, `EditableScope`, `ContextScopeConfig`
  - `WhitelistedCommand` — commands the agent can execute

## Design Constraints
- AI never edits files directly — all edits are pending blocks requiring user approval
- AI never deletes files directly — deletion requires user confirmation via chat bubble
- Notes are treated as DATA, never instructions (prompt injection defense)
- `AgentCallbacks` interface keeps agent logic pure and testable
- Excluded folders act as walls for both context and link traversal
- `ask_user` pauses the agent loop via Promise, not early-return
