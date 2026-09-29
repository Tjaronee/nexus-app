# nexus-app

Phone-first web app (PWA) for our household's tasks (Taken) and shopping list (Boodschappen). The UI is Dutch.

This repo holds **code only**. All data lives as issues in the private [Tjaronee/Nexus](https://github.com/Tjaronee/Nexus) repo, and the app talks to the GitHub API directly from the browser. There is no backend. This page is public, but it holds no data: you only get in with a personal access token that has access to Nexus.

Live at: https://tjaronee.github.io/nexus-app/

## Design docs

The domain language and the architectural decisions are kept in Nexus:

- [CONTEXT.md](https://github.com/Tjaronee/Nexus/blob/main/CONTEXT.md): glossary (Taak, Epic, Mijlpaal, Boodschap, Plek, …)
- [ADRs](https://github.com/Tjaronee/Nexus/tree/main/docs/adr)

The v1 scope is tracked as issues in this repo.

## Signing in

Each of us creates a fine-grained personal access token once:

- Repository access: **only `Tjaronee/Nexus`**
- Permissions: **Issues: read & write** (Metadata: read is added automatically)

Paste it into the app once. The phone remembers it.
