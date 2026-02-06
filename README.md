# ObsidianAgent

An agentic AI assistant for Obsidian that helps you build and maintain your second brain.

## What is this?

This plugin brings a flexible, context-aware AI directly into your Obsidian workflow. Unlike simple chatbots, this assistant understands the *structure* of your vault—it sees your links, reads your connected notes, and can make precise edits across your knowledge base.

Think of it as a collaborator that:
- Answers questions using your actual notes as context
- Proposes edits you can review before accepting
- Understands relationships between your notes
- Searches the web when your vault doesn't have the answer
- Respects boundaries you set (which notes it can see, which it can edit)

## How It Works

ObsidianAgent runs a pipeline of three agents, each handling a different phase of your request:

### Scout Agent
Explores your vault autonomously to find the best context for your task. Uses keyword search, semantic search, link traversal, and vault exploration to select the most relevant notes—so you don't have to pick them manually.

Scout tools include:
- `view_all_notes` — Bird's-eye view of your entire vault with aliases/descriptions from YAML frontmatter
- `explore_vault` — List folder contents or find notes by tag
- `list_all_tags` — Discover all tags in your vault with counts
- `search_keyword` / `search_semantic` — Find notes by keyword or meaning
- `get_links_recursive` — Multi-hop link traversal to explore note connections
- `ask_user` — Ask clarifying questions when the task is ambiguous

Shows live progress of exploration with a collapsible action log.

### Web Agent
When your vault context isn't enough, the Web Agent searches the internet for external information. It evaluates whether a web search is needed, formulates queries, fetches relevant pages, and extracts the useful parts—all automatically.

Supports multiple search APIs (OpenAI, Serper, Brave, Tavily).

### Task Agent
Executes your actual request using the context gathered by the Scout and Web agents. It can answer questions, propose edits, create new notes, or open existing notes—depending on what you asked for.

The Task Agent is aware of *why* each note was selected (semantic relevance, keyword match, link depth) and what the Web Agent found, so it can make informed decisions.

### Manual Context Selection
If you prefer to choose context yourself, you can turn off the Scout Agent and configure context manually:
- Link depth slider (0-3): control how many hops of links to include
- Optional: include all notes in the same folder
- Add individual notes via a picker
- Excluded folders act as walls—blocks traversal, not just exclusion

Each agent can be toggled on or off independently. At minimum, one agent must be enabled.

## Key Features

**Granular Permissions**
- Control which notes the AI can edit (current note, linked notes, or all context notes)
- Toggle capabilities: add content, delete/replace, create new notes, open notes in new tabs
- Exclude sensitive folders entirely
- **Hard enforcement**: Rules are validated after the AI responds, not just suggested via prompts

**Smart Token Management**
- Set a token limit for context sent to the AI
- When the limit is exceeded, notes are automatically trimmed by priority
- Priority order: manual notes removed first, then semantic, folder, linked—current note is never removed
- Notification when notes are removed from context

**Model Selection**
- Choose your preferred OpenAI model (gpt-5-mini, gpt-5-nano, gpt-5, gpt-4o, o1, etc.)
- Separate model selection for the Scout Agent (use a cheaper model for exploration)
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

## Getting Started

1. Install the plugin
2. Add your OpenAI API key in settings
3. (Optional) Choose your preferred AI model
4. Open the ObsidianAgent panel (brain icon in the ribbon)
5. Start asking questions or requesting edits

The AI proposes changes as pending edit blocks inline in your notes. Review each one and click Accept or Reject. You stay in control.

## Philosophy

Your second brain should be *yours*. This plugin is designed to assist, not automate. Every edit is a proposal. Every change requires your approval. The AI sees what you allow it to see and edits only what you permit.

Build your knowledge base with an assistant that respects your agency.

## For Developers

The plugin uses a modular architecture:
- `src/ai/` — Agent implementations (Scout, Web, Task), prompt building, context utilities, validation
- `src/edits/` — Edit lifecycle management and diff computation
- `src/modals/` — UI components (token warnings, context preview, note picker, edit preview)
- `src/utils/` — Structured logging
- `src/types.ts` — Shared type definitions (PipelineContext, agent configs, etc.)

See `CLAUDE.md` for detailed developer documentation.

---

*Currently in active development. Contributions and feedback welcome.*
