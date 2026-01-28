# AI Assistant Plugin - Developer Reference

## TODO

- [ ] Fix the "current note only" selection as other notes still receive edits even when it is clicked. Make it not prompt dependent (enforce in validation, not just AI instructions).

## Architecture Overview

This is an Obsidian plugin that provides an agentic AI assistant for note editing and Q&A. It uses OpenAI's API (gpt-4o-mini) and implements a pending edit system where AI-proposed changes are inserted as reviewable blocks.

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
- `computeNewContent()` - Applies position-based edit to content string
- `buildContextWithScope()` - Builds context string with line numbers
- `buildEditSystemPrompt()` - Constructs system prompt with dynamic rules

### AIAssistantView
- `handleEditMode()` - Orchestrates edit flow: API call → parse → validate → insert blocks
- `handleQAMode()` - Simple Q&A flow

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
