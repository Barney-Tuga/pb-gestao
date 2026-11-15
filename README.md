# PB Gestao

PB Gestao is a planned business-management application. This repository contains
an initial technical skeleton, not an operational management system.

## Planned technology

- API: ASP.NET Core and C#.
- Web interface: Angular and TypeScript, initially as a responsive progressive
  web app (PWA).
- Database: PostgreSQL, accessed through the backend rather than directly from
  the web interface.

The Windows experience is initially planned for a browser. Native integration,
including Tauri, may be evaluated later if needed.

## Current status

The ASP.NET Core API exposes `GET /health`, a process health check that does not
check a database or external services. The Angular app is a placeholder, not a
functional public website. There are no ERP features, authentication, offline
synchronization or fiscal document issuance.

The PWA service worker caches application assets in production builds; it does
not cache API data. Read-only access to business data while offline remains a
future goal when cached data is available. The data-cache strategy has not been
selected, and future writes must be blocked while offline. Official fiscal
documents remain outside this application's scope and are issued through the
existing fiscal system.

Deployment architecture, database access technology, local database setup,
offline caching, production operating system and backup strategy remain to be
decided.

## Local development

The skeleton was generated and validated with .NET SDK 10.0.404 targeting
`net10.0`, Node.js 24.19.0, npm 11.17.0, Angular 22.2.6, Angular CLI 22.2.7
and TypeScript 6.0.3. Install a compatible .NET 10 SDK and Node.js version
before running the following commands.

```sh
dotnet run --project src/api
```

The default development profile listens on `http://localhost:5222`; visit
`http://localhost:5222/health` to check the API process. No database is required.

```sh
cd src/web
npm ci
npm start
```

The Angular development server displays its local URL. Its service worker is
disabled in development; PWA caching is enabled in the production build and
requires HTTPS or localhost.

To validate the skeleton:

```sh
dotnet build src/api
cd src/web
npm run build
npm test -- --watch=false
```

The initial validation completed successfully: both production web and API
builds passed, both Angular tests passed, and `/health` returned HTTP 200.

## Repository safety

This is a public repository. Do not commit credentials, secrets, customer or
supplier data, confidential business records, or real operational configuration.
