# ObsidianAgent – Pricing Reference (Value-Focused)

> **Last updated:** February 2026  
> **Goal:** best value for **general LLM use**, **tool-calling**, **embeddings**, **web search**  
> **Legend:** `(UNCERTAIN)` = pricing or availability not fully verified

---

## 0) Quick defaults (TL;DR)

- **General + tool-calling default:** `gpt-5-mini`
- **Ultra-cheap routing / classification:** `gpt-5-nano`
- **Reasoning escalation:** `gpt-5`
- **Embeddings default:** `text-embedding-3-small`
- **External web search:** Serper.dev (cheapest in practice)
- **OpenAI web search tool:** Preview mode, chosen per cost model

---

## 1) OpenAI – Chat / Tool Models

Prices per **1M tokens**.

| Model | Input | Cached input | Output | Notes |
|---|---:|---:|---:|---|
| `gpt-5-nano` | $0.05 | $0.005 | $0.40 | **Cheapest viable model**, great for routing & tools |
| `gpt-5-mini` | $0.25 | $0.025 | $2.00 | **Best default** for agents |
| `gpt-5` | $1.25 | $0.125 | $10.00 | Reasoning step-up |
| `gpt-5.1` | $1.25 | $0.125 | $10.00 | Similar tier, eval-dependent |
| `gpt-5.2` | $1.75 | $0.175 | $14.00 | Use selectively |
| `gpt-4o-mini` | $0.15 | $0.075 | $0.60 | Still good, now beaten by nano |
| `gpt-4o` | $2.50 | $1.25 | $10.00 | Rarely best value |

**Recommendation**
- Start with `gpt-5-mini`
- Drop to `gpt-5-nano` for cheap steps
- Escalate only on failure

---

## 2) Embedding Models

Prices per **1M tokens**.

| Model | Price | Batch price | Dim | Notes |
|---|---:|---:|---:|---|
| `text-embedding-3-small` | $0.02 | $0.01 | 1536 | **Best default** |
| `text-embedding-3-large` | $0.13 | $0.065 | 3072 | Rarely worth it |
| `voyage-3-lite` | ~$0.02 | — | 512 | (UNCERTAIN) cheap alt |
| Google `text-embedding-004` | Free (limits) | — | 768 | (UNCERTAIN) great if available |

---

## 3) Web Search – OpenAI Tool

Costs are **per 1,000 tool calls**.

| Mode | Tool cost | Search content tokens | When to use |
|---|---:|---|---|
| Preview (reasoning models) | $10 / 1k | Billed as input tokens | Transparent, cache-friendly |
| Preview (non-reasoning) | $25 / 1k | **Free** | Predictable spend |
| Non-preview (mini models) | $10 / 1k | **Fixed 8k token block** | Watch out for hidden cost |

**Rule of thumb**
- Few searches → reasoning preview
- Many searches → non-reasoning preview
- Avoid non-preview unless you’ve measured cost

---

## 4) External Web Search APIs

| API | Cost / search | Free tier | Notes |
|---|---:|---:|---|
| **Serper.dev** | ~$0.001 | 2,500 | **Best value** |
| **Brave Search API** | ~$0.003 | 2,000/mo | Privacy-focused |
| **Exa.ai** | ~$0.003 | (UNCERTAIN) | AI-native results |
| **Tavily** | ~$0.01 | 1,000/mo | Heavy extraction |

---

## 5) Practical Cost Heuristics

### Cheap agent step
- Model: `gpt-5-nano`
- Use for: intent detection, tool selection, short summaries

### Default agent step
- Model: `gpt-5-mini`
- Use for: multi-tool workflows, synthesis, edits

### Hard reasoning
- Model: `gpt-5`
- Use for: planning, deep logic, long code reasoning

### Web research step
- External search + LLM eval
- **Typical cost:** ~$0.002–0.006 per query if optimized

---

## 6) Final “best value” stack

**If you want one sane setup:**

- LLM: `gpt-5-mini`
- Router: `gpt-5-nano`
- Embeddings: `text-embedding-3-small`
- Search: Serper.dev
- Escalation: `gpt-5` only on failure

---

## 7) What to ignore

- Legacy GPT-4 / GPT-4-Turbo
- Preview-only hype models
- Audio / realtime models
- Anything without stable API pricing