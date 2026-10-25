# TuniProf

Tunisian marketplace for private tutoring (tuniprof.tn). Read `docs/AGENT_CONTEXT.md`, `docs/SPEC.md`, then `docs/PROGRESS.md`.

## Run it locally

1. One-time database setup: see `db/setup-local.sql` (instructions at the top of the file).
2. Copy `.env.example` to `.env.local` and put your database password in it.
3. Install and start:

```bash
npm install
npm run db:reset
npm run dev
```

Open http://localhost:3000 (French) and http://localhost:3000/ar (Arabic).

## Useful commands

| Command                                                 | What it does                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `npm run dev`                                           | Start the site for development                                 |
| `npm run lint` / `npm run typecheck` / `npm run format` | Check and tidy the code                                        |
| `npm test`                                              | Run the tests                                                  |
| `npm run db:migrate`                                    | Apply new database migrations                                  |
| `npm run db:reset`                                      | Erase the development database and rebuild it                  |
| `npm run db:reset:test`                                 | Same, for the test database                                    |
| `npm run admin:create -- --role=admin_super`            | Create an admin account (asks for phone and a hidden password) |
| `npm run build`                                         | Build the production version                                   |
