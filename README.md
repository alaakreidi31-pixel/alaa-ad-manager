# ALAA AD MANAGER

Internal platform of **ALAA MARKETING GROUP** for managing clients,
paid advertising campaigns (Meta & Google), budgets, management fees,
invoices, and performance reports.

## Status

Phase 0 — Project foundation (in progress)

## Tech Stack

- Frontend: React + TypeScript (Vite)
- Backend: Node.js + NestJS + TypeScript
- Database: PostgreSQL 17 + Prisma
- Package manager: pnpm (monorepo)
- Languages: Arabic & English (RTL support)

## Quick Start

```bash
pnpm install
pnpm dev     # API on 127.0.0.1:3000, web on 127.0.0.1:5173
pnpm check   # format, lint, typecheck and tests
```

First-time setup (database user, `.env`): see [docs/development.md](docs/development.md).

## Documentation

All project documentation is in [docs/](docs/README.md) (Arabic), including the
architecture overview and the architecture decision records (ADR).

## Security Principles

- Never commit `.env` files or any secrets.
- Client ad-platform passwords are never stored.
- Platform integrations use official APIs and OAuth only.
- Each client can access only their own data.
