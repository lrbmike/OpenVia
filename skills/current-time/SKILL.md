---
name: Current Time Expert
description: Get the current system time, handle timezone conversions accurately by identifying OS and system timezone, and format dates/times across different environments.
version: 1.1.0
author: OpenVia
tags: [time, datetime, utility, timezone, bun, powershell]
---

# Current Time Expert

This skill allows the agent to provide precision system time and perform
accurate timezone conversions. It prioritizes environment detection to avoid
errors caused by OS differences.

## 1. Environment Detection (Critical)

Before getting the time, always identify the environment to choose the correct
command:

- **Detect OS**: Check if running on `Windows` (PowerShell) or
  `Linux/macOS/Docker` (Bash/Zsh).
- **Detect System Timezone**:
  - **Windows**: `[System.TimeZoneInfo]::Local.Id`
  - **Linux**: `cat /etc/timezone` or `date +%Z`

## 2. High-Precision Cross-Platform Method (Recommended)

Use **Bun** or **Node.js** for the most reliable timezone handling. This avoids
OS-specific timezone database issues.

### Get Time in Specific Timezone (e.g., Seoul)

```bash
bun -e "console.log(new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full', timeStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date()))"
```

_Note: This automatically handles Daylight Saving Time (DST) and uses standard
IANA Timezone IDs._

## 3. OS-Specific Commands

### Windows (PowerShell)

| Requirement            | PowerShell Command                                                                                                             |
| :--------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| **Current Local Time** | `Get-Date -Format 'yyyy-MM-dd HH:mm:ss'`                                                                                       |
| **UTC Time**           | `[System.DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss')`                                                                    |
| **Convert Timezone**   | `[System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::Now, 'Tokyo Standard Time').ToString('yyyy-MM-dd HH:mm:ss')` |

### Linux / macOS (Bash)

| Requirement            | Bash Command                                |
| :--------------------- | :------------------------------------------ |
| **Current Local Time** | `date '+%Y-%m-%d %H:%M:%S'`                 |
| **UTC Time**           | `date -u '+%Y-%m-%d %H:%M:%S'`              |
| **Convert Timezone**   | `TZ='Asia/Seoul' date '+%Y-%m-%d %H:%M:%S'` |

## 4. Best Practices

1. **Identify OS First**: Never assume the environment. Run a quick check if
   unsure.
2. **Use IANA IDs**: For timezone conversion, prefer `Asia/Shanghai`,
   `America/New_York` style names, especially with the Bun/Node.js method.
3. **Reference UTC**: If direct conversion fails, get the current UTC time
   first: `[DateTime]::UtcNow` (Win) or `date -u` (Linux), then apply the
   offset.
4. **Avoid Hardcoding Offsets**: Let the system (Intl API or TZ database) handle
   DST and leap seconds.
