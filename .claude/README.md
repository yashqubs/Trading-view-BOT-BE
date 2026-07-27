# Backend `.claude` Setup

This folder configures Claude Code for the trading bot backend (NestJS). It encodes the project's context, rules, commands, and operational scripts so Claude works consistently and safely.

## Files

```
README.md                      Human entry point — setup, commands, architecture
CLAUDE.md                      Root context + documentation reference
.claude/
├── PROJECT_DOCUMENTATION.md   Full project documentation (source of truth)
├── settings.json              Permissions (allow/deny) for Claude Code
├── rules.md                   Coding + security + trade-safety rules
├── commands/
│   ├── new-module.md          /new-module — scaffold a NestJS module
│   ├── pre-deploy.md          /pre-deploy — full safety + quality gate
│   └── audit-trade-path.md    /audit-trade-path — review the signal→trade pipeline
└── scripts/
    ├── backup-to-s3.sh        Nightly DB backup to encrypted S3 (cron at 02:00)
    ├── restore-from-s3.sh     Restore DB from latest/specified S3 dump
    ├── ci.yml                 Reference copy of the workflow (live one is in .github/)
    └── dependabot.yml         Reference copy (live one is in .github/)

.github/
├── workflows/ci.yml           Live CI/CD — lint/build/test/audit on every push+PR,
│                               then SSH-deploys to EC2 (migrate + pm2 restart) on push to main
└── dependabot.yml             Weekly dependency update PRs
```

The `ci.yml`/`dependabot.yml` under `.claude/scripts/` are reference copies only. **Editing them changes nothing** — GitHub reads `.github/`.

## How to use

1. Place `CLAUDE.md` at the repo root and the `.claude/` folder at the repo root.
2. Make the scripts executable: `chmod +x .claude/scripts/*.sh`.
3. Add the backup cron on the EC2 server: `0 2 * * * /path/to/.claude/scripts/backup-to-s3.sh >> /var/log/db-backup.log 2>&1`.
4. Edit the placeholders in the scripts (bucket name, region, secret names) to match your AWS setup.
5. For the CD half of `.github/workflows/ci.yml` to work, add repo secrets `EC2_HOST`, `EC2_SSH_USER`, `EC2_SSH_KEY` and repo variable `DEPLOY_PATH` under GitHub → Settings → Secrets and variables → Actions. See Section 18 Phase 2b of `PROJECT_DOCUMENTATION.md`.

## Slash commands

- `/new-module <name>` — scaffolds a module following conventions
- `/pre-deploy` — runs build, lint, test, coverage, audit + manual safety review
- `/audit-trade-path` — audits the most critical code: the signal-to-trade pipeline

## Key safety principles encoded here

- Secrets only from AWS Secrets Manager, never .env, never logged
- Fail-safe on trades: when uncertain, skip and log
- **Mandatory position resolution before every trade, in both directions** — one position per ticker, never hedged; the signal opens, closes, or skips depending on what's already open, never on its own direction alone
- Never trust IG's `confirmDeal` alone — reconcile against `GET /positions` before logging FAILED
- Condition pipeline order is fixed
- Every portal endpoint JWT-guarded (the one deliberate exception, `POST /auth/logout`, is explained in `rules.md`); webhook IP + secret guarded
- A lapsed session must always be recoverable without clearing cookies by hand
- Dependency scanning gates deployment
- CI (lint/build/test/audit) must pass before CD deploys — enforced by `needs:` in `.github/workflows/ci.yml`, not just convention
