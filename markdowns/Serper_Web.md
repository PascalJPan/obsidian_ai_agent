## Conceptual Overview: LLM + Web Search

### Why web search exists

LLMs:

* Do **not** have live internet access
* Have **stale knowledge**
* Hallucinate on recent facts

Web search solves this by:

1. Querying a **search API**
2. Retrieving **fresh text**
3. Feeding that text into the LLM
4. Asking the LLM to **summarize / extract / reason**

The LLM **never browses**. It only reads text you give it.

---

## Architecture Patterns

### Pattern A — Built-in LLM Search Tool (expensive)

```
LLM
 └─ calls internal search tool
     └─ provider performs search
         └─ results injected into model context
```

Pros:

* Simple
* Integrated

Cons:

* Fixed per-call fees
* Less control
* Harder to cache

---

### Pattern B — External Search API (recommended)

```
Your code
 ├─ calls search API (Serper / Brave / Bing)
 ├─ gets JSON results
 ├─ selects relevant text
 └─ sends text to LLM for reasoning
```

Pros:

* Cheaper
* Full control
* Cacheable
* Model-agnostic (Claude, GPT, Gemini)

This is what **Serper.dev** is for.

---

## Serper.dev — What It Is

* A **Google Search API wrapper**
* Returns **structured JSON**
* Extremely cheap
* No browser automation
* No scraping logic required

Typical cost:

* ~$0.001 per search
* 2,500 free searches (as of writing)

---

## What Serper Returns

A typical Serper response includes:

* Organic results (title, snippet, link)
* Knowledge graph (if available)
* Optional news / images / maps

You choose:

* How many results
* What text to keep
* What to pass to the LLM

---

## Minimal Serper Workflow

### Step 1 — Search

```text
User question
→ convert to search query
→ call Serper
```

### Step 2 — Reduce

```text
Serper JSON
→ select top N snippets
→ trim length
→ concatenate
```

### Step 3 — Reason

```text
Reduced text
→ send to LLM
→ ask for summary / answer
```

---

## Example: Serper API Call (JavaScript)

```js
import fetch from "node-fetch";

const response = await fetch("https://google.serper.dev/search", {
  method: "POST",
  headers: {
    "X-API-KEY": process.env.SERPER_API_KEY,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    q: "Claude MCP server fetch tool",
    num: 5
  })
});

const data = await response.json();
```

---

## Example: Extract Text for LLM

```js
const context = data.organic
  .map(r => `Title: ${r.title}\nSnippet: ${r.snippet}`)
  .join("\n\n");
```

---

## Example: Pass to Claude

```text
You are given web search results below.
Use only this information to answer.

<SearchResults>
${context}
</SearchResults>

Question:
Explain how MCP servers provide indirect web access.
```

Claude:

* Reads the snippets
* Reasons normally
* Produces answer
* No browsing assumptions needed

---

## Cost Comparison (Mental Model)

| Setup                  | Typical cost      |
| ---------------------- | ----------------- |
| LLM only               | ~$0.002–0.005     |
| LLM + built-in search  | ~$0.02–0.05       |
| **Serper + cheap LLM** | **~$0.003–0.008** |

This is why Serper + Claude is attractive.

---

## Best Practices

### Reduce cost

* Limit results (`num: 3–5`)
* Strip HTML
* Trim snippets
* Cache identical queries

### Improve quality

* Rephrase queries (agent-side)
* Ask LLM to generate search queries
* Use multiple searches only if needed

---

## Important Constraints (Claude-specific)

Claude:

* Has **no internet**
* Cannot call Serper directly
* Must be **given search text**
* Should not assume freshness unless stated

Always tell Claude:

> “The following information comes from a live web search.”

---

## One-Sentence Summary (for Claude)

> Web search is done externally via APIs like Serper.dev; the LLM never browses, it only reads search results that are fetched, reduced, and injected into its context for reasoning.
