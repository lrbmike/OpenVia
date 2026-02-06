# Web Search Skill

This skill enables your AI agent to perform web searches using the Brave Search
API. It provides real-time access to information directly from the command line.

## Prerequisites

- **Bun**: Ensure you have [Bun](https://bun.sh/) installed (`v1.0.0` or
  higher).
- **Brave Search API Key**: You need a valid API key from Brave.

## Setup

1. **Get an API Key**:
   - Visit [Brave Search API](https://api.search.brave.com/app/dashboard) and
     sign up for a plan (there is a free tier).
   - Generate an API key.

2. **Configure Environment**:
   - You need to expose the `BRAVE_SEARCH_API_KEY` environment variable.
   - You can add it to your shell profile (e.g., `~/.bashrc`, `~/.zshrc`):
     ```bash
     export BRAVE_SEARCH_API_KEY="your_api_key_here"
     ```
   - Or set it temporarily for the session:
     ```bash
     $env:BRAVE_SEARCH_API_KEY="your_api_key_here" # PowerShell
     export BRAVE_SEARCH_API_KEY="your_api_key_here" # Bash
     ```

## Usage

Once configured, the agent can use this skill by running the provided script.
You can also test it manually:

```bash
# Linux / macOS
bun run ~/.openvia/skills/web-search/scripts/search.ts "OpenVia GitHub"

# Windows (PowerShell)
bun run "$HOME/.openvia/skills/web-search/scripts/search.ts" "OpenVia GitHub"
```

## Output Format

The script outputs search results in Markdown format, which is optimized for the
AI agent to read and process.

```markdown
# Search Results for "OpenVia GitHub"

### 1. [OpenVia - GitHub](https://github.com/lrbmike/OpenVia)

> Universal, Extensible CLI Gateway for AI Agents ...
```
