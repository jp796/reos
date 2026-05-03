---
name: HelpDocsKeeper
description: |
  Keeps docs/HELP_KNOWLEDGE.md up to date as features ship. The
  AI Help assistant at /help reads this file as its knowledge base
  — when it's stale, users get wrong / outdated answers. This skill
  fires automatically whenever code changes ship a new feature,
  endpoint, page, or settings panel.

  USE WHEN: shipping any new page (add to feature reference), API
  endpoint (document path + body shape), Settings section (link
  from Settings index), Skill, brokerage profile, integration
  adapter, OR any UI flow that changes how the user accomplishes a
  task. Also fire when REMOVING / RENAMING any of the above —
  stale entries in HELP_KNOWLEDGE.md mislead users worse than
  missing entries.
---

# HelpDocsKeeper

`docs/HELP_KNOWLEDGE.md` is the single source of truth the AI Help
assistant reads to answer how-to questions. **It must mirror the
actual app** — every new page, endpoint, settings panel, or major
flow gets an entry; every removal / rename gets a delete or update.

## Triggers

Fire on any commit that:

- Adds a new route under `src/app/<page>/page.tsx`
- Adds a new API endpoint under `src/app/api/<...>/route.ts`
- Adds a new section to `src/app/settings/page.tsx`
- Adds a new skill under `.claude/skills/`
- Adds a new BrokerageProfile / state rule / integration adapter
- Renames a feature or path
- Removes a feature or path

## What to update

Find the relevant section in `docs/HELP_KNOWLEDGE.md` and update:

1. **Feature reference** — the human-readable description.
2. **UI path** — keep the exact `/path` and breadcrumb (e.g.
   "Settings → Brokerage").
3. **Quick mention in "Common questions"** if the change addresses
   a frequent user gap.
4. **Cron table** if a new scheduled job lands.

## Format rules

- ≤ 600 characters per feature entry.
- Always include the exact route path or breadcrumb.
- Use plain prose; bullet lists only when listing 3+ items.
- No marketing fluff; the audience is users who already have REOS.
- Keep examples concrete (Wyoming addresses, real-feel scenarios).

## Auto-fire workflow

When a PR commit touches any of the trigger paths above:

1. Read the changed file's front-matter / header docstring.
2. Locate the matching section in `docs/HELP_KNOWLEDGE.md`.
3. Diff the existing entry vs the new behavior.
4. Patch the doc in the SAME commit (don't ship code without doc).
5. Commit message includes: `docs: update HELP_KNOWLEDGE for <feature>`

## Bonus — quarterly audit

Once per quarter:

- Read every section of `docs/HELP_KNOWLEDGE.md`.
- Click through each referenced UI path. Confirm it still exists.
- Delete entries for removed features.
- Promote new "common questions" based on the last 90 days of
  support replies (when we have any).

## Why a skill instead of CI

Could be a CI check, but Claude is the one editing the codebase.
Putting the policy in a skill means every change naturally invokes
the audit — no separate CI pipeline to maintain.
