/**
 * Default Dataview Reference info tool.
 * Shipped as a built-in Custom Info Tool so users get it out of the box.
 * Source: official Dataview docs (v0.5.70, April 2025).
 */

import { CustomInfoTool } from '../types';

export const DEFAULT_DATAVIEW_TOOL: CustomInfoTool = {
	id: 'default-dataview-reference',
	name: 'Dataview Reference',
	toolName: 'info_dataview_reference',
	triggerDescription: 'Complete Dataview reference — DQL syntax (TABLE/LIST/TASK/CALENDAR), data commands, all 60+ functions, implicit fields, DataviewJS API, inline queries, metadata types, and common patterns. Call when user needs help with Dataview queries.',
	contentType: 'inline',
	inlineContent: `# Dataview Complete Reference

Current version: **0.5.70** (April 2025, maintainer: holroy). Plugin repo: blacksmithgu/obsidian-dataview.

---

## 1. Query Formats

### DQL Codeblock
\`\`\`\`
\`\`\`dataview
TABLE rating AS "Rating", summary AS "Summary"
FROM #games
SORT rating DESC
\`\`\`
\`\`\`\`

### Inline DQL
Embeds a single computed value in running text. Default prefix is \`=\` (configurable).
\`\`\`
Today is \\\`= date(today)\\\` and this file is \\\`= this.file.name\\\`.
\`\`\`
- Access current page fields via \`this.fieldname\`
- Access other pages via \`[[Page]].fieldname\`
- Displays exactly one value

### DataviewJS Codeblock
\`\`\`\`
\`\`\`dataviewjs
let pages = dv.pages("#books").where(b => b.rating >= 7);
dv.table(["Book", "Rating"], pages.map(b => [b.file.link, b.rating]));
\`\`\`
\`\`\`\`

### Inline DataviewJS
Prefix: \`$=\` (configurable).
\`\`\`
Last modified: \\\`$= dv.current().file.mtime\\\`
\`\`\`
Has access to the full \`dv\` API.

---

## 2. DQL Query Types

### TABLE
\`\`\`
TABLE [field1 [AS "Header1"], field2, ...] [WITHOUT ID]
FROM <source>
[data commands...]
\`\`\`
- Renders a table with one row per result
- First column is file link by default; \`WITHOUT ID\` removes it
- Use \`AS "Custom Name"\` for column headers
- Supports computed columns: \`TABLE (rating * 2) AS "Double Rating"\`

### LIST
\`\`\`
LIST [additional_info] [WITHOUT ID]
FROM <source>
[data commands...]
\`\`\`
- Bullet-point list of page links
- One optional additional info field per entry
- \`WITHOUT ID\` hides file link when additional info is shown
- Supports computed values: \`LIST "Rating: " + rating\`

### TASK
\`\`\`
TASK
FROM <source>
[WHERE conditions]
[GROUP BY field]
\`\`\`
- Interactive task list; checking tasks modifies the source file
- Operates at task level, not page level
- Child tasks appear when parent matches even if child does not
- \`GROUP BY file.link\` groups by source file

### CALENDAR
\`\`\`
CALENDAR <date_field>
FROM <source>
[WHERE conditions]
\`\`\`
- Monthly calendar view with dots on dates
- Requires a date field (the only query type that requires additional info)
- SORT and GROUP BY have no effect
- Recommended: \`WHERE typeof(due) = "date"\` to filter invalid dates

---

## 3. Data Commands

### FROM (sources)
Must come immediately after query type. Only one FROM allowed.

| Source | Syntax | Description |
|--------|--------|-------------|
| Tag | \`FROM #tag\` | Includes subtags (e.g., #tag/subtag) |
| Folder | \`FROM "folder"\` | Includes subfolders |
| Single File | \`FROM "path/to/file"\` | Specific file |
| Incoming Links | \`FROM [[note]]\` | Pages that link TO this note |
| Outgoing Links | \`FROM outgoing([[note]])\` | Pages that this note links TO |

**Combining sources:**
- \`FROM #tag AND "folder"\` -- both conditions
- \`FROM [[Food]] OR [[Exercise]]\` -- either condition
- \`FROM -#tag\` -- negation (exclude)
- \`FROM #tag AND -"folder"\` -- combined with negation

### WHERE
\`\`\`
WHERE <expression>
\`\`\`
Filters to pages where expression evaluates to truthy.
- \`WHERE file.mtime >= date(today) - dur(1 day)\`
- \`WHERE contains(file.tags, "#important")\`
- \`WHERE rating > 7 AND status = "complete"\`
- Multiple WHERE clauses are AND-combined sequentially

### SORT
\`\`\`
SORT field [ASC|DESC], field2 [ASC|DESC], ...
\`\`\`
- Default: ascending
- \`SORT file.mtime DESC\`
- \`SORT rating DESC, file.name ASC\`

### GROUP BY
\`\`\`
GROUP BY field [AS name]
\`\`\`
- Groups results; creates \`rows\` array containing grouped pages
- Access grouped data via \`rows.fieldname\` (field swizzling)
- Example: \`TABLE rows.file.link, rows.rating GROUP BY genre\`

### FLATTEN
\`\`\`
FLATTEN field [AS name]
\`\`\`
- Expands array fields into one row per array element
- \`FLATTEN authors\` -- one row per author
- \`FLATTEN file.tags AS tag\` -- one row per tag

### LIMIT
\`\`\`
LIMIT <number>
\`\`\`
- Caps output to N results
- Order matters: \`LIMIT 5\` then \`SORT\` sorts only those 5

**Command order:** All commands except FROM can appear multiple times in any order after the query type and FROM. They execute in written order.

---

## 4. Expressions

### Field Access
- Direct: \`rating\`, \`due-date\`
- Spaces normalized: \`"My Field"\` becomes \`my-field\`
- Bold/italic stripped: \`**Bold Field**\` becomes \`bold-field\`
- Current file: \`this.fieldname\`
- Linked page: \`[[Page]].fieldname\`

### Literals
| Type | Examples |
|------|----------|
| Number | \`42\`, \`-3.14\`, \`1337\` |
| String | \`"hello world"\` |
| Boolean | \`true\`, \`false\` |
| Date | \`date(2024-01-15)\`, \`date(today)\`, \`date(now)\`, \`date(tomorrow)\`, \`date(yesterday)\`, \`date(sow)\`, \`date(eow)\`, \`date(som)\`, \`date(eom)\`, \`date(soy)\`, \`date(eoy)\` |
| Duration | \`dur(1 day)\`, \`dur(2h 30m)\`, \`dur(1 yr 6 mo)\` |
| Link | \`[[Page]]\`, \`[[Page|Display]]\` |
| List | \`[1, 2, 3]\`, \`[[1,2],[3,4]]\` |
| Object | \`{ key: "value", num: 42 }\` |
| Null | \`null\` |

**Duration abbreviations:** s/sec/second, m/min/minute, h/hr/hour, d/day, w/wk/week, mo/month, yr/year

**Date keywords:** today, tomorrow, yesterday, now, sow (start of week), eow (end of week), som (start of month), eom, soy (start of year), eoy

### Operators
| Type | Operators |
|------|-----------|
| Arithmetic | \`+\`, \`-\`, \`*\`, \`/\`, \`%\` |
| Comparison | \`=\`, \`!=\`, \`<\`, \`>\`, \`<=\`, \`>=\` |
| Logical | \`AND\`, \`OR\`, \`NOT\` |
| Index | \`list[0]\`, \`object["key"]\`, \`object.key\` |

### Lambda Expressions
\`\`\`
(x) => x.field
(a, b) => a + b
\`\`\`
Used in \`map()\`, \`filter()\`, \`minby()\`, \`maxby()\`, \`any()\`, \`all()\`, \`none()\`.

---

## 5. Functions

### Constructors
| Function | Description |
|----------|-------------|
| \`object(key1, val1, ...)\` | Create object from alternating key-value pairs |
| \`list(val1, val2, ...)\` | Create list (alias: \`array\`) |
| \`date(any)\` | Parse date from string/link; accepts ISO 8601 and keywords |
| \`date(text, format)\` | Parse date using Luxon format tokens |
| \`dur(any)\` | Parse duration from string |
| \`number(string)\` | Extract first number from string |
| \`string(any)\` | Convert to string representation |
| \`link(path, [display])\` | Create internal link |
| \`embed(link, [embed?])\` | Convert link to embedded format |
| \`elink(url, [display])\` | Create external URL link |
| \`typeof(any)\` | Return type name as string |

### Numeric
| Function | Description |
|----------|-------------|
| \`round(num, [digits])\` | Round to nearest integer or N digits |
| \`trunc(num)\` | Remove decimal portion |
| \`floor(num)\` | Round down |
| \`ceil(num)\` | Round up |
| \`min(a, b, ...)\` | Minimum value (also accepts array) |
| \`max(a, b, ...)\` | Maximum value (also accepts array) |
| \`sum(array)\` | Sum of numeric array |
| \`product(array)\` | Product of numeric array |
| \`reduce(array, op)\` | Reduce with operator: \`+\`, \`-\`, \`*\`, \`/\`, \`&\`, \`|\` |
| \`average(array)\` | Arithmetic mean |
| \`minby(array, func)\` | Element with minimum value by function |
| \`maxby(array, func)\` | Element with maximum value by function |

### String
| Function | Description |
|----------|-------------|
| \`contains(container, val)\` | Case-sensitive containment check (works on strings, lists, objects) |
| \`icontains(container, val)\` | Case-insensitive containment |
| \`econtains(container, val)\` | Exact match (no recursive descent) |
| \`containsword(str, val)\` | Word-level match, case-insensitive |
| \`regextest(pattern, str)\` | Test if regex matches part of string |
| \`regexmatch(pattern, str)\` | Test if regex matches entire string |
| \`regexreplace(str, pat, rep)\` | Replace regex matches |
| \`replace(str, pat, rep)\` | Replace literal matches |
| \`lower(str)\` | Lowercase |
| \`upper(str)\` | Uppercase |
| \`split(str, delim, [limit])\` | Split string (delimiter is regex) |
| \`startswith(str, prefix)\` | Prefix check |
| \`endswith(str, suffix)\` | Suffix check |
| \`padleft(str, len, [char])\` | Left-pad |
| \`padright(str, len, [char])\` | Right-pad |
| \`substring(str, start, [end])\` | Extract slice |
| \`truncate(str, len, [suffix])\` | Truncate with suffix (default "...") |
| \`length(val)\` | Length of string, list, or object |
| \`reverse(list)\` | Reverse list |
| \`sort(list)\` | Sort list |
| \`flat(array, [depth])\` | Flatten nested arrays |
| \`join(array, [delim])\` | Join into string |
| \`filter(array, pred)\` | Filter by predicate function |
| \`map(array, func)\` | Transform each element |
| \`unique(array)\` | Remove duplicates |
| \`slice(array, [start, [end]])\` | Shallow copy portion |
| \`nonnull(array)\` | Remove null values |
| \`firstvalue(array)\` | First non-null element |
| \`any(array, [pred])\` | True if any truthy/matching |
| \`all(array, [pred])\` | True if all truthy/matching |
| \`none(array, [pred])\` | True if none truthy/matching |
| \`extract(obj, k1, k2, ...)\` | Pull specific fields from object |

### Date & Duration
| Function | Description |
|----------|-------------|
| \`dateformat(date, fmt)\` | Format date using Luxon tokens (e.g., \`"yyyy-MM-dd"\`, \`"MMMM dd, yyyy"\`) |
| \`durationformat(dur, fmt)\` | Format duration with tokens: \`y\`, \`M\`, \`w\`, \`d\`, \`h\`, \`m\`, \`s\`, \`S\` |
| \`striptime(date)\` | Remove time component, keep date |
| \`localtime(date)\` | Convert to local timezone |

### Utility
| Function | Description |
|----------|-------------|
| \`default(field, value)\` | Return value if field is null |
| \`choice(bool, left, right)\` | Ternary: returns left if true, right if false |
| \`hash(seed, [text], [variant])\` | Generate fixed hash for deterministic randomization |
| \`currencyformat(num, [currency])\` | Format number as currency (ISO 4217) |
| \`meta(link)\` | Get link metadata: \`.display\`, \`.embed\`, \`.path\`, \`.subpath\`, \`.type\` |

---

## 6. Adding Metadata

### YAML Frontmatter
\`\`\`yaml
---
title: "My Note"
rating: 8
tags: [book, fiction]
due: 2024-06-15
author: "Jane Doe"
thoughts:
  rating: 9
  mood: positive
---
\`\`\`
All frontmatter fields are automatically available as Dataview fields. Supports nested objects accessed via dot notation (\`thoughts.rating\`).

### Inline Fields
**Standard** (own line, key is visible):
\`\`\`
Basic Field:: Some random Value
\`\`\`

**Bracketed** (inline, key visible):
\`\`\`
I rate this [rating:: 9] out of 10. It was [mood:: great].
\`\`\`

**Parenthesized** (inline, key hidden in Reader mode):
\`\`\`
This has a hidden (secret-field:: value) key.
\`\`\`

Bracketed fields are the **only way** to add fields to specific list items and tasks.

### Key Naming
- Spaces become hyphens: \`Basic Field\` -> \`basic-field\`
- Formatting stripped: \`**Bold**\` -> \`bold\`
- UTF-8 and emoji supported (emoji needs brackets: \`[emoji:: value]\`)

---

## 7. Data Types

| Type | Format | Examples |
|------|--------|----------|
| Text | Any string | \`"hello"\`, unquoted values |
| Number | Integer or decimal | \`6\`, \`3.14\`, \`-200\` |
| Boolean | true/false | \`true\`, \`false\` |
| Date | ISO 8601 | \`2024-01-15\`, \`2024-01-15T14:30:00\` |
| Duration | \`<time> <unit>\` | \`6 hours\`, \`4min\`, \`1 yr 6 mo\` |
| Link | Wiki-link | \`[[Page]]\`, \`[[Page|Display]]\` |
| List | YAML list or comma-separated | \`[a, b, c]\` |
| Object | YAML nested | \`{key: value}\` (YAML frontmatter only) |

**Date field access:** \`field.year\`, \`field.month\`, \`field.weekyear\`, \`field.week\`, \`field.weekday\`, \`field.day\`, \`field.hour\`, \`field.minute\`, \`field.second\`, \`field.millisecond\`

**Duration field access:** \`field.years\`, \`field.months\`, \`field.weeks\`, \`field.days\`, \`field.hours\`, \`field.minutes\`, \`field.seconds\`, \`field.milliseconds\`

---

## 8. Implicit Fields (Pages)

| Field | Type | Description |
|-------|------|-------------|
| \`file.name\` | Text | File title (without extension) |
| \`file.folder\` | Text | Folder path the file belongs to |
| \`file.path\` | Text | Full file path including name |
| \`file.ext\` | Text | File extension (usually \`md\`) |
| \`file.link\` | Link | Link to the file |
| \`file.size\` | Number | File size in bytes |
| \`file.ctime\` | Date+Time | Creation date/time |
| \`file.cday\` | Date | Creation date (no time) |
| \`file.mtime\` | Date+Time | Last modified date/time |
| \`file.mday\` | Date | Last modified date (no time) |
| \`file.tags\` | List | All unique tags (subtags broken down by level) |
| \`file.etags\` | List | All explicit tags (subtags NOT broken down) |
| \`file.inlinks\` | List | Incoming links to this file |
| \`file.outlinks\` | List | Outgoing links from this file |
| \`file.aliases\` | List | Aliases from YAML frontmatter |
| \`file.tasks\` | List | All tasks \`[ ]\` in this file |
| \`file.lists\` | List | All list elements (including tasks) |
| \`file.frontmatter\` | Object | Raw frontmatter as key-value pairs |
| \`file.day\` | Date | Date from filename or Date field type |
| \`file.starred\` | Boolean | Bookmarked via Obsidian Bookmarks plugin |

---

## 9. Implicit Fields (Tasks & List Items)

| Field | Type | Description |
|-------|------|-------------|
| \`status\` | Text | Character inside \`[ ]\` brackets |
| \`checked\` | Boolean | True if status character is non-empty |
| \`completed\` | Boolean | True only if status is \`x\` |
| \`fullyCompleted\` | Boolean | True if task AND all subtasks are completed |
| \`text\` | Text | Plain text of the task (includes inline fields) |
| \`visual\` | Text | Rendered text (customizable via DataviewJS) |
| \`tags\` | List | Tags within task text |
| \`outlinks\` | List | Links in the task |
| \`line\` | Number | Line number in the file |
| \`lineCount\` | Number | Number of markdown lines the item spans |
| \`path\` | Text | Full file path |
| \`section\` | Link | Link to containing section |
| \`link\` | Link | Link to closest linkable block |
| \`parent\` | Number | Line number of parent task (null if top-level) |
| \`children\` | List | Subtasks/sublists |
| \`task\` | Boolean | True if task, false if regular list item |
| \`blockId\` | Text | Block ID if defined with \`^id\` |
| \`annotated\` | Boolean | True if task has any inline field annotations |
| \`completion\` | Date | Completion date (emoji shorthand) |
| \`due\` | Date | Due date (emoji shorthand) |
| \`created\` | Date | Created date (emoji shorthand) |
| \`start\` | Date | Start date (emoji shorthand) |
| \`scheduled\` | Date | Scheduled date (emoji shorthand) |

**Task date emoji shorthands** (from Tasks plugin compatibility):
- Due: \`🗓️YYYY-MM-DD\`
- Completed: \`✅YYYY-MM-DD\`
- Created: \`➕YYYY-MM-DD\`
- Scheduled: \`⏳YYYY-MM-DD\`
- Start: \`🛫YYYY-MM-DD\`

Tasks inherit all fields from their parent page.

---

## 10. DataviewJS API (\`dv.*\`)

### Page Queries
| Method | Description |
|--------|-------------|
| \`dv.current()\` | Page object for the current file |
| \`dv.pages(source)\` | Data array of pages matching source (same syntax as FROM) |
| \`dv.pagePaths(source)\` | Array of file paths matching source |
| \`dv.page(path)\` | Single page object from path or link |

### Rendering
| Method | Description |
|--------|-------------|
| \`dv.header(level, text)\` | Render heading (level 1-6) |
| \`dv.paragraph(text)\` | Render paragraph |
| \`dv.span(text)\` | Render inline span |
| \`dv.el(element, text, {cls, attr})\` | Render arbitrary HTML element |
| \`dv.list(elements)\` | Render bullet list |
| \`dv.table(headers, rows)\` | Render table (headers = string[], rows = any[][]) |
| \`dv.taskList(tasks, [groupByFile])\` | Render interactive task list; \`false\` = flat list |

### Markdown (returns string, no render)
| Method | Description |
|--------|-------------|
| \`dv.markdownTable(headers, values)\` | Table as markdown string |
| \`dv.markdownList(values)\` | List as markdown string |
| \`dv.markdownTaskList(tasks)\` | Task list as markdown string |

### DQL Execution
| Method | Description |
|--------|-------------|
| \`dv.execute(source)\` | Execute DQL query and render result |
| \`dv.executeJs(source)\` | Execute DataviewJS code |
| \`dv.query(source, [file, settings])\` | Execute DQL, return structured result \`{successful, value}\` |
| \`dv.tryQuery(source, [file, settings])\` | Like query() but throws on failure |
| \`dv.queryMarkdown(source, [file, settings])\` | Execute DQL, return rendered markdown |
| \`dv.tryQueryMarkdown(source)\` | Like queryMarkdown() but throws on failure |

### Expression Evaluation
| Method | Description |
|--------|-------------|
| \`dv.evaluate(expression, [context])\` | Evaluate DQL expression, return Result object |
| \`dv.tryEvaluate(expression, [context])\` | Like evaluate() but throws on failure |

### Utilities
| Method | Description |
|--------|-------------|
| \`dv.array(value)\` | Convert to Dataview data array |
| \`dv.isArray(value)\` | Check if value is array |
| \`dv.fileLink(path, [embed?, display])\` | Create file link object |
| \`dv.sectionLink(path, section, [embed?, display])\` | Create section link |
| \`dv.blockLink(path, blockId, [embed?, display])\` | Create block link |
| \`dv.date(text)\` | Parse to Luxon DateTime |
| \`dv.duration(text)\` | Parse to Luxon Duration |
| \`dv.compare(a, b)\` | Compare values (-1, 0, 1) |
| \`dv.equal(a, b)\` | Check equality |
| \`dv.clone(value)\` | Deep clone |
| \`dv.parse(value)\` | Parse string to Dataview type (link, date, duration) |

### File I/O
| Method | Description |
|--------|-------------|
| \`dv.io.load(path, [origin])\` | Load file contents as string (async) |
| \`dv.io.csv(path, [origin])\` | Load CSV as data array of objects (async) |
| \`dv.io.normalize(path, [origin])\` | Resolve relative path to absolute vault path |

### External
| Property | Description |
|----------|-------------|
| \`dv.luxon\` | Access to Luxon DateTime/Duration library |
| \`dv.view(path, input)\` | Load and run external JS view (async) |

---

## 11. Common Query Patterns

### List all notes in a folder
\`\`\`dataview
LIST FROM "Projects"
\`\`\`

### Table with custom columns
\`\`\`dataview
TABLE status, due, priority AS "!"
FROM #task
WHERE !completed
SORT due ASC
\`\`\`

### Tasks due this week
\`\`\`dataview
TASK
WHERE due >= date(sow) AND due <= date(eow)
WHERE !completed
SORT due ASC
\`\`\`

### Recently modified files
\`\`\`dataview
TABLE file.mtime AS "Modified"
WHERE file.mtime >= date(today) - dur(7 days)
SORT file.mtime DESC
LIMIT 20
\`\`\`

### Group by tag
\`\`\`dataview
TABLE rows.file.link AS "Notes"
FROM #project
GROUP BY status
\`\`\`

### Notes linking to current note
\`\`\`dataview
LIST FROM [[]]
\`\`\`

### Flatten tags and count
\`\`\`dataview
TABLE length(rows) AS "Count", rows.file.link AS "Notes"
FLATTEN file.tags AS tag
GROUP BY tag
SORT length(rows) DESC
\`\`\`

### Calendar of due dates
\`\`\`dataview
CALENDAR due
FROM #task
WHERE typeof(due) = "date"
\`\`\`

### DataviewJS: custom rendering
\`\`\`dataviewjs
const pages = dv.pages("#book").where(p => p.rating >= 8);
dv.table(
  ["Book", "Author", "Rating"],
  pages.sort(p => p.rating, 'desc')
       .map(p => [p.file.link, p.author, "⭐".repeat(p.rating)])
);
\`\`\`

### Inline: show field value
\`\`\`
This project is due on \\\`= this.due\\\` and has priority \\\`= this.priority\\\`.
\`\`\`

### Default values for missing fields
\`\`\`dataview
TABLE default(status, "N/A") AS "Status", default(priority, "Low") AS "Priority"
FROM "Projects"
\`\`\``,
	enabled: true,
};
