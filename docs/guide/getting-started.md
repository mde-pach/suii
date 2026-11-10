# Getting started

suii needs three things: a template that describes the question, a workflow step that uses the action, and permission for the workflow to write issues.

## 1. Write a template

Templates live in your repository, for example in `.github/suii/`:

```yaml
# .github/suii/release.yml
title: "Release {{ vars.version }}: go / no-go"
fields:
  - id: target
    type: choice
    label: Where does it go?
    options:
      - { label: Staging, value: staging, default: true }
      - { label: Production, value: production }
  - id: changelog
    type: confirm
    label: The changelog is reviewed
    required: true
submit: Ship it
```

## 2. Add the step

```yaml
name: Release

on: workflow_dispatch

permissions:
  contents: read   # to check out the template
  issues: write    # to open and edit the question
  actions: read    # to close questions left behind by dead runs

jobs:
  release:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5

      - uses: mde-pach/suii@v1
        id: ask
        with:
          template: .github/suii/release.yml
          vars: version=2.4.0
          timeout: 900          # seconds; keep it below timeout-minutes
          assignees: ${{ github.actor }}

      - run: ./deploy.sh "$TARGET"
        env:
          TARGET: ${{ steps.ask.outputs.target }}
```

## 3. Answer

The run's log and annotations link to the new issue, and assignees get a GitHub notification. Tick your answers, then tick the submit box (**Ship it** here). Within one poll interval (10 seconds by default), suii:

1. checks that the person who ticked has write access,
2. checks that nothing but checkboxes changed,
3. closes the issue with a record of the answer,
4. sets the outputs, and the workflow continues.

If the answer is incomplete, for example a required box is not ticked, suii unticks the submit box and comments what is missing.

## Good to know

- **Pass outputs through `env:`**, as above, rather than inlining `${{ }}` in a script.
- **Public repositories** make every question and answer public. Use [`issue-repo`](/reference/inputs-outputs) to ask in a private repository instead.
- **Runner minutes** are billed while the step waits. For long waits, put suii in a small job of its own and pass its outputs to the job that does the work.
- **Fork pull requests** get a read-only token, so suii cannot open issues there.
