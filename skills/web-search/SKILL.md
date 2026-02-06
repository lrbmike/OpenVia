---
name: Web Search (Brave)
description: Perform real-time web searches using Brave Search API to retrieve up-to-date information.
version: 1.0.0
author: OpenVia
tags: [search, web, brave, internet]
---

# Web Search

Use this skill to access the internet and find the latest information on any
topic.

## When to Use

- When the user asks for current events, news, or real-time data.
- When you need to verify facts that might have changed since your training
  cutoff.
- When searching for documentation, libraries, or technical solutions.

## How to Execute

Execute the search script using `bun`:

**Linux / macOS:**

```bash
bun run ~/.openvia/skills/web-search/scripts/search.ts "<query>"
```

**Windows (PowerShell):**

```powershell
bun run "$HOME/.openvia/skills/web-search/scripts/search.ts" "<query>"
```

**Example:**

```bash
bun run "$HOME/.openvia/skills/web-search/scripts/search.ts" "Bun 1.2 release notes"
```

## Configuration

This skill requires the `BRAVE_SEARCH_API_KEY` environment variable to be set in
your `.env` file or environment.
