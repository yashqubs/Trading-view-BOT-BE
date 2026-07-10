---
description: Scaffold a new NestJS module following project conventions
---

Create a new NestJS module named `$ARGUMENTS` following this project's conventions.

Generate:
1. `src/$ARGUMENTS/$ARGUMENTS.module.ts` — the module definition, importing TypeOrmModule.forFeature for any entities
2. `src/$ARGUMENTS/$ARGUMENTS.controller.ts` — thin controller, JWT-guarded endpoints, DTO-validated
3. `src/$ARGUMENTS/$ARGUMENTS.service.ts` — service with constructor DI, explicit return types
4. `src/$ARGUMENTS/dto/` — request/response DTOs with class-validator decorators
5. `src/$ARGUMENTS/entities/` — TypeORM entities if this module owns data
6. `test/$ARGUMENTS.service.spec.ts` — unit test skeleton with mocked dependencies

Follow the rules in `.claude/rules.md`:
- Controller stays thin, logic in the service
- Every endpoint guarded with JwtAuthGuard
- DTOs validated, sensitive fields excluded from responses
- Explicit return types, no `any`
- Register the module in `app.module.ts`

After generating, run `pnpm build` and `pnpm lint` to confirm it compiles cleanly.
