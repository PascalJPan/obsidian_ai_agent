# AI Assistant Plugin - Developer Reference

## TODO

- [x] Fix the "current note only" selection as other notes still receive edits even when it is clicked. Make it not prompt dependent (enforce in validation, not just AI instructions). **DONE**: Implemented `filterEditsByRules()` for hard enforcement.

## Architecture Overview

This is an Obsidian plugin that provides an agentic AI assistant for note editing and Q&A. It uses OpenAI's API (configurable model) and implements a pending edit system where AI-proposed changes are inserted as reviewable blocks.

## Key Concepts

### Modes
- **Q&A Mode**: Simple question answering based on note context
- **Edit Mode**: AI proposes structured edits as JSON, which get converted to pending edit blocks

### Scopes
- **Context Scope** (`ContextScope`): Which notes are sent to AI as context
  - `current`: Only the active note
  - `linked`: Current + outgoing links + backlinks
  - `folder`: All notes in same folder

- **Editable Scope** (`EditableScope`): Which notes AI is allowed to edit
  - `current`: Only current note
  - `linked`: Current + linked notes
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

### MyPlugin
- `insertEditBlocks()` - Batches edits by file, processes bottom-to-top to prevent line shift issues
- `applyEditBlockToContent()` - Applies edit block to content string in memory
- `resolveEdit()` - Accepts/rejects a pending edit
- `validateEdits()` - Validates AI instructions, resolves files, computes new content
- `filterEditsByRules()` - **HARD ENFORCEMENT**: Validates edits against capabilities and editable scope
- `getEditableFiles()` - Returns set of file paths allowed for editing based on scope
- `computeNewContent()` - Applies position-based edit to content string
- `buildContextWithScope()` - Builds context string with line numbers
- `buildEditSystemPrompt()` - Constructs system prompt with dynamic rules
- `buildForbiddenActions()` - Generates explicit warnings for disabled capabilities

### AIAssistantView
- `handleEditMode()` - Orchestrates edit flow: API call → parse → validate → filter → insert blocks
- `handleQAMode()` - Simple Q&A flow
- `buildMessagesWithHistory()` - Builds API messages array with rich chat history context

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
- `main.ts` - All plugin code (single file)
- `styles.css` - Widget and view styling
- `manifest.json` - Plugin metadata
