# Qard

A focused Q-card workspace built with React, Vinext and Cloudflare D1.

## Features

- Projects containing courses, each containing front/back Q-cards
- Create, edit, and delete projects, courses, and cards
- Animated study cards, shuffled practice, learned status, and repeat practice
- Private per-user saved workspaces and optimistic concurrency checks
- Mobile layout, keyboard controls, reduced-motion support
- Editable example courses for first-time visitors

## Development

Install dependencies with `npm ci`, then run `npm run dev`.
The local preview uses the bundled local sign-in page.

The database schema is in `db/schema.ts`; generated migrations are in `drizzle/`.
Build with `npm run build`, then apply pending migrations to the local D1 database using the generated `dist/server/wrangler.json` configuration and `.wrangler/state` persistence directory.
Production identity comes from the Sites platform. The local sign-in simulator is excluded from production builds.

## Verification

`npx tsc --noEmit` checks TypeScript. `npm run build` creates the Worker build.
The creation and study flow was verified through the browser. API checks cover unauthenticated access, malformed relationships, stale version conflicts, cross-site request protection, and saved data read-back.
