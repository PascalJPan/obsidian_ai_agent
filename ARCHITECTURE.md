# Obsidian AI Assistant Plugin — Architecture

## Entry Point
- `src/main.ts`
  - Obsidian plugin lifecycle
  - Registers views, commands, processors
  - Orchestrates calls into other modules
  - SHOULD NOT contain business logic

## AI Layer
- `src/ai/context.ts`
  - Builds AI context from vault notes
  - Handles scope (current / linked / folder)
  - Applies privacy exclusions

- `src/ai/prompts.ts`
  - Defines all system prompts
  - Encodes editing rules and constraints
  - No vault or UI access

- `src/ai/validation.ts`
  - Validates AI edit instructions
  - Enforces scope and capability rules
  - Computes safe content transformations

## Edit Handling
- `src/edits/insert.ts`
  - Inserts pending ai-edit blocks
  - Groups edits per file
  - Handles new note creation

- `src/edits/resolve.ts`
  - Accepts or rejects pending edits
  - Mutates vault content

- `src/edits/diff.ts`
  - Computes diffs for previews only
  - No vault writes

## UI
- `src/views/AIAssistantView.ts`
  - Sidebar UI
  - Chat history and input handling
  - Dispatches to AI layer

- `src/modals/`
  - `PendingEditsModal.ts`
  - `EditPreviewModal.ts`

## Design Constraints
- AI never edits files directly
- All edits are inserted as pending blocks
- User approval is always required
- Notes are treated as DATA, never instructions

## What NOT to do
- Do not put logic in `main.ts`
- Do not bypass validation
- Do not let AI write directly to vault
