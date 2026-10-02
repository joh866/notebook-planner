# Start here

## What's in this folder

- `PRODUCT_SPEC.md`: everything we decided. Claude Code treats it as the source of truth.
- `AGENTS.md`: short rules for Claude Code. `CLAUDE.md` just points to it.
- `PROGRESS.md`: the build plan as numbered steps, ticked off as they're done.
- `design/prototype-6.html`: the prototype, which Claude Code uses as the look to match.
- `tests/fixtures/todo-oct-1.txt`: your original todo list, for testing the AI.
- `.env.example`: a template for your API key.
- `.gitignore`: keeps your data and keys out of git.

## One-time setup

1. Put this folder somewhere permanent, like `~/Projects/notebook-planner`. Keep your old `planner` folder separate.
2. Open Terminal in the folder and save a starting point:
   ```
   git init
   git add .
   git commit -m "Project docs"
   ```
3. Start Claude Code in the folder with `claude`, and say:
   > Read AGENTS.md and PROGRESS.md, then do the current step.

   Use plan mode, read the plan, then approve it. When a step works, commit it and run `/clear` before the next one.

## Your API key (needed at step 10)

1. Go to platform.claude.com, open Settings, then API keys, and create a key. It's shown only once, so copy it right away. API usage is billed separately from a Claude subscription, so you'll need to add a payment method or credits there.
2. In Terminal, in this folder, run:
   ```
   cp .env.example .env
   open -e .env
   ```
   Paste the key after `ANTHROPIC_API_KEY=` and save.
3. That's all. The server reads it from there. Don't paste the key into a chat, Claude Code included.

Tip: Finder hides files that start with a dot. Press Cmd + Shift + period to show them.

## When to come back to the brainstorm chat

For design questions, reactions to screenshots, or changes to the plan. Ask for an updated `PRODUCT_SPEC.md`, then drop it into this folder.
