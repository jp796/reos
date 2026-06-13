# Extraction regression fixtures

Drop real (or redacted) contract PDFs here with an `expected.json`
sibling to lock in extraction accuracy. **This directory is
gitignored** — the PDFs contain client PII and must never be
committed.

```
1208-windmill-war.pdf
1208-windmill-war.expected.json   # { "closingDate": "2026-06-16", ... }
```

Run:  `OPENAI_API_KEY=$(gcloud secrets versions access latest --secret=OPENAI_API_KEY) bun run scripts/test-extraction.ts`

See `.claude/skills/extraction-quality/SKILL.md` for the full process.
