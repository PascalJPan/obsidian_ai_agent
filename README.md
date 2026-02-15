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

ObsidianAgent runs a single unified agent with a **ReAct loop** (Think → Act → Observe). Instead of a rigid pipeline, one agent autonomously decides what to do at each step—exploring your vault, searching the web, and taking actions—all in one adaptive loop. 

The agent has **35 built-in tools** across 3 categories, plus user-defined **Custom Info Tools**:

**Vault Tools (19)** — explore and understand your vault
- `search_vault` — keyword, semantic, or combined search
- `read_note` — read a note's full content with line numbers
- `list_notes` — browse notes in a folder
- `get_links` — follow outgoing links and backlinks
- `explore_structure` — inspect vault folder structure and tags
- `list_tags` — discover all tags with usage counts
- `get_manual_context` — access manually selected context notes
- `get_properties` — read YAML frontmatter properties
- `get_file_info` — get file metadata (size, dates, etc.)
- `find_dead_links` — detect broken wikilinks
- `query_notes` — advanced note filtering with sorting
- `get_vault_stats` — vault-wide statistics (note count, tags, orphans, etc.)
- `get_chat_history` — retrieve full details of previous conversation rounds
- `get_note_stats` — word count, reading time, and heading structure
- `get_note_connections` — combined links, backlinks, and shared-tag neighbors
- `get_selection` — get the user's current text selection
- `preview_pending_edits` — list unresolved pending edit blocks
- `find_orphan_notes` — find notes with no incoming or outgoing links
- `find_unlinked_mentions` — find text mentions that could be wikilinks

**Web Tools (2)** — search beyond your vault
- `web_search` — search the internet (OpenAI or Serper)
- `read_webpage` — fetch and extract content from a URL

**Action Tools (14)** — make changes and interact
- `edit_note` — propose line-level edits (insert, replace, delete)
- `create_note` — create a new note
- `open_note` — open a note in a new tab
- `move_note` — move or rename a note (reviewable with undo)
- `update_properties` — modify YAML frontmatter (reviewable with undo)
- `add_tags` — add tags to a note (reviewable with undo)
- `link_notes` — propose a wikilink between notes (pending edit)
- `copy_notes` — collect note contents for clipboard
- `delete_note` — propose note deletion (requires user confirmation)
- `execute_command` — run whitelisted Obsidian commands
- `append_to_note` — append content to the end of a note
- `search_and_replace` — find and replace text across notes (pending edits)
- `ask_user` — ask a clarifying question
- `done` — finish and deliver results

**Custom Info Tools (0+)** — user-defined zero-parameter tools that return reference content on demand (e.g., plugin syntax docs, style guides). Ships with a built-in **Dataview Reference** tool.

**Safety guardrails:**
- Hard iteration cap (5-20 rounds, default 10)
- Total token budget (default 100,000)
- Stuck detection: repeating the same tool call 3x triggers a warning and forced finalization
- Cancel button: aborts after the current round via AbortSignal
- Destructive tools (`delete_note`, `execute_command`) disabled by default

### Manual Context Selection
If you prefer to choose context yourself, you can configure it manually:
- Link depth slider (0-3): control how many hops of links to include
- Add individual notes via a picker
- Excluded folders act as walls—blocks traversal, not just exclusion

## Key Features

**Granular Permissions**
- Control which notes the AI can edit (current note, linked notes, or all context notes)
- Toggle capabilities: add content, delete/replace, create new notes, open notes in new tabs
- Enable/disable individual tools via pill toggles in settings
- Exclude sensitive folders entirely
- Whitelist specific Obsidian commands the agent can execute
- **Hard enforcement**: Rules are validated after the AI responds, not just suggested via prompts

**Reviewable Actions**
- **Deletions**: Confirmation bubble with "Keep" / "Delete" — no note is trashed without your approval
- **Moves & renames**: Applied immediately, but an "Undo" / "Keep" bubble lets you revert
- **Property updates**: Previous values are snapshotted — undo restores them
- **Tag additions**: Previous tags are snapshotted — undo restores the original set
- **Link insertions**: Routed through the pending edit system (inline accept/reject in the note)

**Smart Token Management**
- Set a token limit for context sent to the AI
- When the limit is exceeded, notes are automatically trimmed by priority
- Priority order: manual notes removed first, then semantic, folder, linked—current note is never removed
- Notification when notes are removed from context

**Model Selection**
- Choose your preferred OpenAI model (gpt-5-mini, gpt-5-nano, gpt-5, gpt-4o, etc.)
- Custom model pricing: override default $/1M token rates for any model in settings
- Balance cost, speed, and capability for your workflow

**Conversation Memory**
- AI remembers previous messages in your session
- Knows what edits it proposed and what succeeded/failed
- Can refine or fix previous attempts based on feedback
- Configurable history length (0-100 messages)

**Interactive Clarification**
- Agent can ask you questions mid-task with the `ask_user` tool
- Questions appear as an interactive UI with optional choice buttons
- The agent pauses, waits for your answer, then continues its work

**Review Before Commit**
- Every proposed edit appears as a reviewable block in your note
- Accept or reject each change individually
- Batch accept/reject all pending edits
- AI can modify its own pending edits if you ask

**Chat UX**
- Type ahead while the agent is thinking — input stays active during execution
- Select and copy text from any message (user or assistant)
- Agent progress shows notes accessed, web sources, and edits in a collapsible container
- Clickable wikilinks and tags in chat messages

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

```
main.ts              - Entry point, plugin lifecycle, UI, callbacks (~5,800 lines)
src/
  types.ts           - Shared type definitions
  ai/
    agent.ts         - Unified Agent ReAct loop engine
    tools/
      vaultTools.ts  - 19 vault exploration tools
      webTools.ts    - 2 web search tools
      actionTools.ts - 14 action tools
    prompts/
      agentPrompts.ts - Agent system prompt builder
      taskPrompts.ts  - Edit rules, scope, position types
      chatHistory.ts  - Chat history message builder
      index.ts        - Barrel file, shared constants
    context.ts       - Context utilities
    validation.ts    - Edit validation
    searchApi.ts     - Web search wrapper (OpenAI, Serper)
    semantic.ts      - Embedding generation and semantic search
    pricing.ts       - Token usage formatting
  edits/
    editManager.ts   - Edit lifecycle management
    diff.ts          - Diff utilities
  modals/
    index.ts         - Modal components
  defaults/
    dataviewReference.ts - Built-in Dataview Reference info tool
  utils/
    logger.ts        - Structured logging
    fileUtils.ts     - File exclusion utilities
styles.css           - Widget and view styling
```

See `CLAUDE.md` for detailed developer documentation.

---

*Currently in active development. Contributions and feedback welcome.*

## Privacy & Disclaimer

- **API communication**: Note content included in context is sent to OpenAI's API for processing. Only the notes you configure (via context scope, manual selection, or agent tool calls) are transmitted.
- **API key storage**: Your API key is stored locally in Obsidian's plugin data folder and is only sent to OpenAI's API — nowhere else.
- **Costs**: You are responsible for your own OpenAI API usage and associated costs.
- **No guarantees**: All AI-proposed edits require your explicit review and approval. The plugin is provided "as is" under the MIT license — the author is not liable for data loss or unintended modifications. Back up your vault regularly.

## Installation

1. Download the latest release (`main.js`, `manifest.json`, `styles.css`) from the [GitHub releases page](https://github.com/PascalJPan/obsidian_ai_agent/releases)
2. In your vault, navigate to `.obsidian/plugins/` and create a folder called `obsidian-agent`
3. Copy the three downloaded files into that folder
4. Open Obsidian → **Settings → Community plugins** → enable **ObsidianAgent**
5. Go to the ObsidianAgent settings tab and enter your OpenAI API key
6. Click the brain icon in the left ribbon to open the chat panel
