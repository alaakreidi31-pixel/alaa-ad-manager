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

## Security Principles

- Never commit `.env` files or any secrets.
- Client ad-platform passwords are never stored.
- Platform integrations use official APIs and OAuth only.
- Each client can access only their own data.
