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

## Notifications

Every Boodschap is an issue in Nexus, so by default GitHub may notify or email the other partner for each new item. To avoid that, set your watch settings for `Tjaronee/Nexus` to "Participating and @mentions".

## Development

Plain HTML, CSS and ES modules with no build step: GitHub Pages serves `main` as-is. Node is only used for checks.

- `npm test`: unit tests (`node --test`)
- `npm run typecheck`: TypeScript over the JSDoc types
- `npm run icons`: redraw the PNG icons

The service worker ([sw.js](sw.js)) caches the app shell. When you add a file to the shell, add it to `SHELL` there and bump `VERSION`.

## Fallback: the GitHub website

If the app is down, the data stays usable on github.com. The shopping list is `is:open label:boodschappen` (add `label:"waar: praxis"` to filter by Plek), and the task list is `is:open -label:boodschappen`.
