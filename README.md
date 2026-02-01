# Obsidian AI Assistant

An agentic AI assistant for Obsidian that helps you build and maintain your second brain.

## What is this?

This plugin brings a flexible, context-aware AI directly into your Obsidian workflow. Unlike simple chatbots, this assistant understands the *structure* of your vault—it sees your links, reads your connected notes, and can make precise edits across your knowledge base.

Think of it as a collaborator that:
- Answers questions using your actual notes as context
- Proposes edits you can review before accepting
- Understands relationships between your notes
- Respects boundaries you set (which notes it can see, which it can edit)

## Key Features

**Three Modes**
- **Q&A Mode** — Ask questions, get answers grounded in your notes
- **Edit Mode** — Request changes and review them before they're applied
- **Agentic Mode** — AI dynamically explores your vault to find relevant context

**Agentic Mode** (New!)
An AI scout agent explores your vault autonomously to find the best context for your task:
- Uses tools like keyword search, semantic search, and link traversal
- Shows live progress of exploration with collapsible action log
- Selects notes based on task relevance, not static rules
- Then executes your task (Q&A or edit) with the curated context

**Flexible Context** (Q&A & Edit modes)
- Link depth slider (0-3): control how many hops of links to include
  - 0: Current note only
  - 1: Direct links (outgoing + backlinks)
  - 2-3: Links of links (BFS traversal)
- Optional: include all notes in the same folder (additive)
- Excluded folders act as walls—blocks traversal, not just exclusion

**Granular Permissions**
- Control which notes the AI can edit
- Toggle capabilities: add content, delete/replace, create new notes
- Exclude sensitive folders entirely
- **Hard enforcement**: Rules are validated server-side, not just suggested to AI

**Model Selection**
- Choose your preferred OpenAI model (gpt-4o-mini, gpt-4o, gpt-4-turbo, o1, etc.)
- Balance cost, speed, and capability for your workflow

**Conversation Memory**
- AI remembers previous messages in your session
- Knows what edits it proposed and what succeeded/failed
- Can refine or fix previous attempts based on feedback
- Configurable history length (0-100 messages)

**Review Before Commit**
- Every proposed edit appears as a reviewable block in your note
- Accept or reject each change individually
- Batch accept/reject all pending edits
- AI can modify its own pending edits if you ask

## How It Works

1. Open the AI Assistant panel (brain icon in the ribbon)
2. Type your request
3. In Edit mode, the AI proposes changes as pending edits
4. Review the changes inline in your notes
5. Click Accept or Reject

That's it. You stay in control.

## Getting Started

1. Install the plugin
2. Add your OpenAI API key in settings
3. (Optional) Choose your preferred AI model
4. (Optional) Adjust chat history length for conversation memory
5. Open a note and click the brain icon
6. Start asking questions or requesting edits

## Philosophy

Your second brain should be *yours*. This plugin is designed to assist, not automate. Every edit is a proposal. Every change requires your approval. The AI sees what you allow it to see and edits only what you permit.

Build your knowledge base with an assistant that respects your agency.

## For Developers

The plugin uses a modular architecture with the core logic organized in `src/`:
- `src/ai/` — Prompt building, context utilities, edit validation
- `src/edits/` — Diff computation and text processing

See `CLAUDE.md` for detailed developer documentation.

---

*Currently in active development. Contributions and feedback welcome.*
