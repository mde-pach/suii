# suii — Step User Interactive Input

[![CI](https://github.com/mde-pach/suii/actions/workflows/ci.yml/badge.svg)](https://github.com/mde-pach/suii/actions/workflows/ci.yml)

A GitHub Action that pauses a step to ask people a question. It opens an issue form that people answer by ticking boxes or dragging items, checks who answered and what they changed, and gives the answer to the next steps as outputs.

**Documentation: https://mde-pach.github.io/suii/**

```yaml
- uses: mde-pach/suii@v1
  id: ask
  with:
    template: .github/suii/choose-migration.yml   # the question, as a template
    data-file: plan.json                          # data computed by earlier steps

- run: alembic upgrade "$REVISION"
  env:
    REVISION: ${{ steps.ask.outputs.revision }}
```

- **Nothing exposed.** The runner only calls the GitHub API: no tunnel, no public URL, no third-party service. Who can answer is your repository's own permissions.
- **Dynamic choices.** Options come from JSON your earlier steps compute, rendered with Liquid templates.
- **Five field types.** `choice`, `multi`, `confirm`, `rank` (drag to order) and `buckets` (drag into groups).
- **Tamper-proof.** Values never come from the issue text. Every edit's author is checked, and any edit other than ticking boxes or dragging items is reverted.
- **A record of every decision.** The issue is closed with the answer, who gave it and when.
- **Slack notifications.** Optional: a message with a button when a question opens, updated with the outcome when it closes.

## Try it

Run one of the [example workflows](https://github.com/mde-pach/suii/actions) and answer the issue it opens. See [examples/](examples) for the list, including a complete Alembic deployment workflow.

## Develop

```bash
npm install
npm test           # unit tests
npm run typecheck
npm run build      # bundles src/ into dist/ (commit dist/)
npm run docs:dev   # documentation site
```

`dist/` is committed because GitHub runs the action from the repository. CI fails when it is out of date.

## License

[MIT](LICENSE)
