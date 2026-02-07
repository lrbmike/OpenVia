# Changelog

All notable changes to the **OpenVia** project will be documented in this file.

## [0.1.0] - 2026-02-07

### Added

- **Native Multi-LLM Adapters**: Native support for `openai`, `claude`, and
  `gemini` API formats.
- **Multimodal Support**: Full support for image inputs on compatible models
  (e.g., GPT-4o, Claude 3.5 Sonnet).
- **Micro-kernel Architecture**: A completely redesigned Agent Core with
  `Gateway`, `Registry`, `Policy`, and `Executor`.
- **Improved Bot Channels**: Added image/photo support for both Telegram and
  Feishu.
- **Headless Mode**: Efficient execution without heavy SDK dependencies.
- **Skill Loading Strategies**: Support for `eager` (preload all) and `lazy`
  (on-demand via tools) skill loading.
- **New Built-in Tools**:
  - `list_skills`: To see available knowledge extensions.
  - `read_skill`: To explicitly read skill instructions when needed.
- **Improved Policy Engine**: Granular control over shell commands and tool
  permissions.
- **Session Isolation**: Support for independent user sessions and working
  directories.

### Changed

- Refactored `src/ai` to move away from `@anthropic-ai/claude-agent-sdk`.
- Unified configuration schema for multiple LLM providers.
- Improved logging with structured output.
- Optimized tool execution flow (Proposal -> Policy check -> Execution).

### Removed

- Removed `src/ai/claude-sdk.ts` and `src/ai/claude-cli.ts`.
- Removed dependency on heavy external Agent SDKs.

---

## [0.0.1] - 2026-02-01

- Initial public release of OpenVia as an experiment.
- Basic Telegram and Feishu bridge.
- Initial Claude Agent SDK integration.
