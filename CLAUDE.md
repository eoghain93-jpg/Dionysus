# CLAUDE.md — Fairmile

This file provides guidance for AI assistants (Claude and others) working in this repository. Keep it up to date as the project evolves.

---

## Project Status

> **This repository is currently empty / freshly initialized.**
> Update this section once the project has a defined purpose, stack, and structure.

---

## Repository Overview

| Field | Value |
|---|---|
| Repository | eoghain93-jpg/Fairmile |
| Primary Branch | `main` (or `master` — update once established) |
| Remote | `http://local_proxy@127.0.0.1:45761/git/eoghain93-jpg/Fairmile` |

---

## Development Branch Convention

When working as an AI assistant on this repo:

- **Always develop on the designated feature branch**, never directly on `main`/`master`
- Branch names follow the pattern: `claude/<task-description>-<session-id>`
- Push with: `git push -u origin <branch-name>`
- On push failure due to network errors, retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s)

---

## Project Structure

> To be filled in once the project has files.

```
Fairmile/
├── CLAUDE.md          # This file
└── (project files TBD)
```

---

## Tech Stack

> To be filled in once the stack is decided.

- **Language**: TBD
- **Framework**: TBD
- **Package manager**: TBD
- **Database**: TBD
- **Test framework**: TBD

---

## Getting Started

> To be filled in once the project has a setup process.

```bash
# Clone
git clone <repo-url>
cd Fairmile

# Install dependencies
# (command TBD)

# Run development server
# (command TBD)

# Run tests
# (command TBD)
```

---

## Key Commands

> Populate this table once scripts/commands are established.

| Command | Purpose |
|---|---|
| (TBD) | Install dependencies |
| (TBD) | Start dev server |
| (TBD) | Run tests |
| (TBD) | Run linter |
| (TBD) | Build for production |

---

## Environment Variables

> Document required environment variables here as they are introduced.

Create a `.env` file (never commit it) based on `.env.example` (commit this).

```
# Example .env.example format:
# VAR_NAME=description_or_example_value
```

---

## Code Conventions

> Define these once the stack is chosen. Suggestions below are common defaults.

### General
- Prefer clarity over cleverness
- Keep functions small and single-purpose
- Avoid over-engineering: build what is needed now, not hypothetical future requirements
- Do not add error handling for scenarios that cannot happen
- Do not add docstrings/comments to code you didn't change

### Git Commits
- Use imperative mood: `Add feature`, `Fix bug`, `Refactor X`
- Keep the subject line under 72 characters
- Reference issue numbers where relevant: `Fix login redirect (#42)`
- Never skip pre-commit hooks (`--no-verify`) without explicit user permission

### Branching
- Feature branches: `feature/<short-description>`
- Bug fixes: `fix/<short-description>`
- AI-assisted work: `claude/<task-description>-<session-id>`

### Pull Requests
- Keep PRs focused and small
- Write a clear summary of what changed and why
- Include a test plan in the PR description

---

## Testing

> Update once test infrastructure is in place.

- All new features should have corresponding tests
- Tests must pass before merging to `main`
- Do not mark a task complete if tests are failing

---

## Security Notes

- Never commit secrets, credentials, or `.env` files
- Validate all external input at system boundaries
- Avoid introducing OWASP Top 10 vulnerabilities (XSS, SQL injection, command injection, etc.)
- If insecure code is introduced, fix it immediately before proceeding

---

## CI/CD

> Document pipeline steps once CI is configured.

---

## AI Assistant Guidelines

When working in this codebase as an AI assistant:

1. **Read before editing** — always read a file before modifying it
2. **Minimal changes** — only change what is directly required by the task
3. **No unsolicited refactoring** — do not clean up surrounding code, add docstrings, or rename variables unless asked
4. **No speculative features** — do not add configurability, fallbacks, or abstractions for hypothetical future needs
5. **Confirm before destructive actions** — `git reset --hard`, `rm -rf`, force pushes, and similar actions require explicit user approval
6. **Update this file** — when the project structure, stack, or conventions change, update CLAUDE.md to reflect the current state
