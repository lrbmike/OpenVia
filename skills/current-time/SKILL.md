---
name: Current Time Expert
description: Get the current system time, handle timezone conversions, and format dates/times across different operating systems.
version: 1.0.0
author: OpenVia
tags: [time, datetime, utility, timezone]
---

# Current Time Expert

This skill allows the agent to provide accurate system time, format date/time
strings, and perform timezone calculations by executing terminal commands.

## Getting Current Time

Always use the `bash` tool to execute commands for real-time accuracy. Avoid
relying on internal knowledge as it has a cutoff date.

### Multi-Platform Commands

| Platform                 | Command Example                                                |
| :----------------------- | :------------------------------------------------------------- |
| **Windows (PowerShell)** | `powershell -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"` |
| **Linux / macOS**        | `date '+%Y-%m-%d %H:%M:%S'`                                    |

## Time Formatting

Provide time in various formats based on user requirements.

| Format Type        | Example Output              | PowerShell Command              |
| :----------------- | :-------------------------- | :------------------------------ |
| **ISO 8601**       | `2026-02-06T12:15:07+08:00` | `Get-Date -Format o`            |
| **Date Only**      | `2026-02-06`                | `Get-Date -Format 'yyyy-MM-dd'` |
| **Time Only**      | `12:15:07`                  | `Get-Date -Format 'HH:mm:ss'`   |
| **Human Readable** | `Friday, February 6, 2026`  | `(Get-Date).ToLongDateString()` |

## Timezone Handling

To get time in specific timezones or UTC:

### UTC Time

```powershell
[System.DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss')
```

### Specific Timezone (Example: Tokyo)

```powershell
[System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::Now, 'Tokyo Standard Time').ToString('yyyy-MM-dd HH:mm:ss')
```

## Best Practices

1. **Always Verify**: Never guess the time. Use system commands to ensure
   accuracy.
2. **Context Aware**: Adjust the output format and timezone according to the
   user's location or explicit request.
3. **Cross-Platform**: Detect the target environment and choose the appropriate
   `date` or `powershell` command.
