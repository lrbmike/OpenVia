---
name: Find Skills
description: Search for and discover new skills from the open agent skills ecosystem when you lack the necessary capabilities.
version: 1.0.0
author: Vercel Labs & OpenVia
tags: [discovery, skills, package-manager]
---

# Find Skills

This skill helps you discover and install skills from the open agent skills
ecosystem.

## When to Use This Skill

Use this skill when you are trying to achieve a goal but lack the necessary
tools or capabilities:

- The user asks "how do I do X" where X might be a common task with an existing
  skill.
- You need a specific tool to complete a step in your plan, but it is not
  available in your current toolset.
- You encounter an error because a command or tool is missing, and you need to
  find an extension that provides it.

## The Skills CLI

The Skills CLI (`npx skills`) is the package manager for the open agent skills
ecosystem. Skills are modular packages that extend agent capabilities with
specialized knowledge, workflows, and tools.

**Key commands:**

- `npx skills find [query]` - Search for skills interactively or by keyword.
- `npx skills add <package>` - Install a skill.

## How to Find and Install Skills

### Step 1: Search for Skills

Run the `bash` tool with the find command with a relevant query:

```bash
npx skills find [keywords]
```

For example:

- Need to check stock prices? → `npx skills find stock`
- Need to query a database? → `npx skills find postgres`

The command will return results like:

```
Install with npx skills add <owner/repo@skill>

vercel-labs/agent-skills@vercel-react-best-practices
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

### Step 2: Install the Skill

Once you find a suitable skill from the search results, use the `bash` tool to
install it. **CRITICAL: You MUST use the `-g` (global) and `-y` (yes) flags to
ensure it installs without interactive prompts.**

```bash
npx skills add <owner/repo@skill> -g -y
```

### Step 3: Bind the Skill to your Current Context (IMPORTANT)

If you are operating within a Goal-Driven mode, you will see your current
context goal ID in the system prompt (e.g., `Context: Goal-xyz123`).
**CRITICAL:** When installing new skills for a specific task, you MUST attach
them to your temporary task scope so they don't pollute the global agent memory.

Do NOT attempt to manually modify the skill files on the disk (like `sed` or
bash scripts). Instead, use your new built-in tool `bind_skill` right after the
installation has finished successfully. Provide it with the ID of the skill you
just installed and your current goal ID.

For example, if you just installed `postgres` and your prompt says
`Context: Goal-8f43da`: Call Native Tool: `bind_skill` Arguments:

```json
{
  "skill_id": "postgres",
  "goal_id": "Goal-8f43da"
}
```

### Step 4: Use the New Skill

After the installation and the `bind_skill` command complete successfully, the
new skill will be automatically loaded into your context upon your next action.
You can then proceed to use the tools or knowledge provided by the new skill to
complete your task.

## Tips for Effective Searches

1. **Use specific keywords**: "react testing" is better than just "testing".
2. **Try alternative terms**: If "deploy" doesn't work, try "deployment" or
   "ci-cd".
