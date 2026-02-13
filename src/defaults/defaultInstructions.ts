/**
 * Default custom instructions for new installations.
 * Provides a sensible starting template that users can customize or clear.
 */

export const DEFAULT_CUSTOM_INSTRUCTIONS = `## Note Conventions

**Frontmatter schema** (YAML):
- title, tags, status (draft | in-progress | complete | archived), type (note | meeting | project | reference | journal), created (ISO date)

**Naming**: Use descriptive names. Prefix with ISO date (YYYY-MM-DD) for journals and meetings.

**Sections by type**:
- Meeting → Attendees / Agenda / Notes / Action Items
- Project → Overview / Status / Tasks / Links
- Reference → Summary / Details / Related

**Tags**: Use hierarchical tags — status/*, type/*, area/* (e.g. #area/work, #type/meeting).

**Linking**: Prefer [[wikilinks]] to connect related notes. Link liberally to build the graph.
`;
