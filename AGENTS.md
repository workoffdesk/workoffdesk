# Working in this repository

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: the layout, how to run from source, and the checks.
`apps/mobile` has its own [AGENTS.md](apps/mobile/AGENTS.md).

## This is a public repository

- Commit messages, pull requests, issues, code, comments and docs carry no personal names, quotes from
  conversations, private domains, account or team IDs, signing keys, usernames or home-folder paths. Use
  `workoffdesk.example.com` for an address and `com.example.workoffdesk` for a bundle id.
- Notes that are not for the public (handoffs, plans, conversations, someone's own setup) never go in a
  tracked file. `docs/private/` and `CLAUDE.local.md` are git-ignored for notes kept on one machine.

## Docs

- `docs/guide/` has fixed file names, each page a pair: `name.md` in English and `name.zh-CN.md` in Chinese,
  with the same headings. `README.md` and `README.zh-CN.md` are a pair the same way.
- `docs/design/` holds design notes, named `YYYY-MM-DD-topic.md`.
- The README and the guide say only what [docs/facts.md](docs/facts.md) backs. A change that adds a claim
  adds its fact, with the file or command that shows it, in the same pull request.
- Screenshots in `docs/screens/` come from `apps/server/tests/e2e/screens.spec.ts`
  (`pnpm --filter workoffdesk screens`) and the demo GIFs from `apps/server/tests/e2e/demo/make.sh`
  (`pnpm --filter workoffdesk demo`), never from a hand-taken capture.
- `pnpm check` runs `scripts/check-docs.mjs`, which checks that every page has its pair with the same headings,
  that links lead somewhere, that every file a page names in backticks under `apps/`, `libs/`, `scripts/` or
  `docs/` exists, and that the test map in `docs/testing.md` is whole.

## Code

- Tests first: write the test, watch it fail for the right reason, then make it pass.
- Comments in English, and few.
- `pnpm check` passes before a change is done.
