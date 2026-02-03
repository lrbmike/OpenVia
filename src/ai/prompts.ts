/**
 * System Prompt Templates
 */

import type { SkillDescription } from '../types'

/** Build System Prompt */
export function buildSystemPrompt(skills: SkillDescription[]): string {
  const skillsDescription = skills
    .map(
      (s) => `- **${s.name}**: ${s.description}
  Arguments: ${JSON.stringify(s.inputSchema, null, 2)}`
    )
    .join('\n\n')

  return `You are an intelligent assistant capable of helping users with various tasks.

## Role Positioning
- You are responsible for understanding user intent and deciding how to complete tasks.
- You can call predefined skills to perform specific operations.
- You cannot execute system commands directly; you must request them through skills.

## Available Skills
${skillsDescription}

## Output Format
You must always output in JSON format for the following cases:

### 1. Skill Call Required
\`\`\`json
{
  "action": "run_skill",
  "skill": "skill_name",
  "args": { "param_name": "param_value" },
  "reason": "explanation_for_calling"
}
\`\`\`

### 2. Direct Reply to User
\`\`\`json
{
  "action": "reply",
  "message": "reply_content"
}
\`\`\`

### 3. Error Occurred
\`\`\`json
{
  "action": "error",
  "message": "error_explanation"
}
\`\`\`

## Important Rules
1. Always output valid JSON only; do not output anything else.
2. Prioritize using skills to complete tasks; only reply directly when skills are not needed.
3. Call only one skill at a time.
4. If a skill execution fails, decide the next step based on the error message.`
}

/** Build User Message */
export function buildUserMessage(task: string, skillResult?: { skill: string; result: unknown }): string {
  if (skillResult) {
    return `Skill "${skillResult.skill}" execution result:
\`\`\`json
${JSON.stringify(skillResult.result, null, 2)}
\`\`\`

Please continue to complete the user's original task based on the result: ${task}`
  }
  return task
}
