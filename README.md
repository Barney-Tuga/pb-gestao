# PB Gestao

PB Gestao is a web application under development. The public repository contains
the application source and generic developer documentation; it does not contain
private business requirements, production configuration, or operational data.

## Technology

- API: ASP.NET Core and C# on .NET 10.
- Web: the original `pwa_pb` interface is served using the existing Angular
  development and build tooling; its source is plain HTML, CSS and JavaScript.
- Database: PostgreSQL, accessed only by the API through EF Core and Npgsql.

The initial Windows experience is in a browser. Native integration and
production hosting remain future decisions.

## Current status

The API exposes an anonymous `GET /health` process check; it does not verify
database connectivity. The `pwa_pb` interface is connected to the existing
API for local-account authentication, articles, prices, VAT rates and units.
Other modules remain demonstrations and are not connected to the API. Their
sample data must not be used as business records. Database setup and an
administrator account are required before signing in. The demo credentials
from the original interface do not authenticate against this API. This is not
a production deployment guide.

Open **Artigos** and select **Procurar** for the server-backed catalogue;
**Criar** opens the API-backed article form for administrators, with a choice
of existing units.
The original article sheet remains a visual demonstration, not an editor for
server data.

The service worker caches application assets but does not cache API or
authentication requests. API-backed writes are blocked when the browser
reports that it is offline. Other modules retain local demonstration
behaviour and are not business data storage; customer and supplier saves and
POS checkout explicitly report that no operation was performed. Offline
synchronization, fiscal document issuance, and production deployment
configuration are not implemented here.

## Local development

Validated tool versions: .NET SDK 10.0.404, ASP.NET Core / EF Core 10.0.15,
Npgsql EF Core 10.0.3, Node.js 24.19.0, npm 11.17.0, Angular 22.2.6, Angular
CLI 22.2.7, and TypeScript 6.0.3. Install compatible .NET 10 and Node.js
tooling before running the commands below.

1. Start a local PostgreSQL instance and create a development database.
2. Configure the API connection string outside source control, for example with
   .NET user-secrets:

   ```sh
   dotnet user-secrets set "ConnectionStrings:DefaultConnection" "<local connection string>" --project src/api
   ```

3. Apply the checked-in EF Core migrations explicitly:

   ```sh
   dotnet run --project src/api -- --migrate-database
   ```

4. Create the first administrator using the one-time `--bootstrap-admin`
   command. Supply `PB_BOOTSTRAP_ADMIN_EMAIL` and
   `PB_BOOTSTRAP_ADMIN_PASSWORD` through the local process environment; do not
   store either value in source control. The bootstrap command refuses to run
   when users already exist.
5. Start the API and web development server in separate terminals:

   ```sh
   dotnet run --project src/api
   ```

   ```sh
   cd src/web
   npm ci
   npm start
   ```

The API development profile listens on `http://localhost:5222`; `/health`
reports process health. The development server proxies `/auth` and `/api` to
that address. Production hosting must serve the interface and API under the
same origin and route those paths to the API. The service worker can run on
localhost or HTTPS.

To reset the password of the single existing administrator in a local
development database, run `--reset-admin-password` in the Development
environment with `PB_ADMIN_RESET_PASSWORD` set only in the process environment.
The command uses ASP.NET Identity's password-reset token flow, requires a
loopback database host, and does not print or persist the password. It is not a
production recovery mechanism.

## Validation

The API integration tests create and remove an isolated PostgreSQL database.
Set `PB_TEST_ADMIN_CONNECTION_STRING` to a local PostgreSQL connection string
whose user can create and drop databases before running them.

```sh
dotnet build src/api
dotnet test tests/PbGestao.Api.Tests
cd src/web
npm ci
npm run build
npm test -- --watch=false
npm run test:reference
```

## Repository safety

Never commit credentials, secrets, customer or supplier data, private business
requirements, or real operational configuration to this public repository.
