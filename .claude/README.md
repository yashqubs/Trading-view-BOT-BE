# Backend `.claude` Setup

This folder configures Claude Code for the trading bot backend (NestJS). It encodes the project's context, rules, commands, and operational scripts so Claude works consistently and safely.

## Files

```
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
    ├── dependabot.yml         → move to .github/dependabot.yml in your repo
    └── ci.yml                 → move to .github/workflows/ci.yml in your repo
```

## How to use

1. Place `CLAUDE.md` at the repo root and the `.claude/` folder at the repo root.
2. Move `dependabot.yml` to `.github/dependabot.yml` and `ci.yml` to `.github/workflows/ci.yml`.
3. Make the scripts executable: `chmod +x .claude/scripts/*.sh`.
4. Add the backup cron on the EC2 server: `0 2 * * * /path/to/.claude/scripts/backup-to-s3.sh >> /var/log/db-backup.log 2>&1`.
5. Edit the placeholders in the scripts (bucket name, region, secret names) to match your AWS setup.

## Slash commands

- `/new-module <name>` — scaffolds a module following conventions
- `/pre-deploy` — runs build, lint, test, coverage, audit + manual safety review
- `/audit-trade-path` — audits the most critical code: the signal-to-trade pipeline

## Key safety principles encoded here

- Secrets only from AWS Secrets Manager, never .env, never logged
- Fail-safe on trades: when uncertain, skip and log
- Mandatory SELL position check
- Condition pipeline order is fixed
- Every endpoint role-guarded; webhook IP + secret guarded
- Dependency scanning gates deployment
