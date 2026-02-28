---
name: HTTP Fetch
description: Make HTTP requests to REST APIs or web pages. Use this cross-platform skill instead of curl or powershell Invoke-WebRequest.
version: 1.0.0
author: OpenVia
tags: [http, fetch, api, curl, web]
---

# HTTP Fetch

This skill provides a cross-platform way to make HTTP requests (GET, POST, etc.)
and fetch data from the web or REST APIs. **Always use this skill INSTEAD OF
`curl`, `wget`, or PowerShell `Invoke-WebRequest`.**

## Usage

Use the `bash` tool to run the fetch script.

### Basic GET Request (cross-platform safe)

```bash
bun run "$HOME/.openvia/skills/fetch/scripts/fetch.ts" "https://api.github.com/users/octocat"
```

_On Windows PowerShell, `$HOME` usually resolves to your user directory. If needed, use `$env:USERPROFILE/.openvia/...` with forward slashes._

### Advanced Requests (Method, Headers, Body)

You can pass a JSON string as the second argument to specify options like
method, headers, and body.

```bash
bun run "$HOME/.openvia/skills/fetch/scripts/fetch.ts" "https://jsonplaceholder.typicode.com/posts" '{"method":"POST","headers":{"Content-Type":"application/json"},"body":"{\\"title\\":\\"foo\\",\\"body\\":\\"bar\\",\\"userId\\":1}"}'
```

## Path Rule (Important)

- Always prefer forward slashes (`/`) in script paths, even on Windows.
- Always quote full script paths.

## When to use

- Fetching JSON data from an API (like weather, stocks, user info).
- Getting the HTML content of a specific web page.
- Sending webhooks or API commands.
