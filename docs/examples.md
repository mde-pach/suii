# Examples

Each example is a workflow in the suii repository that you can run from its [Actions tab](https://github.com/mde-pach/suii/actions). It opens a real issue; answer it and watch the run continue. Past runs are kept as closed issues labelled [`suii`](https://github.com/mde-pach/suii/issues?q=label%3Asuii).

| Example | Shows | Workflow | Template |
| --- | --- | --- | --- |
| Choose a migration | `choice` and `confirm`, generated and disabled options | [example-migration.yml](https://github.com/mde-pach/suii/blob/main/.github/workflows/example-migration.yml) | [choose-migration.yml](https://github.com/mde-pach/suii/blob/main/.github/suii/choose-migration.yml) |
| Release checklist | `choice` with a default, required `confirm` boxes | [example-release-checklist.yml](https://github.com/mde-pach/suii/blob/main/.github/workflows/example-release-checklist.yml) | [release-checklist.yml](https://github.com/mde-pach/suii/blob/main/.github/suii/release-checklist.yml) |
| Feature flags | `multi` with `min` / `max`, options filtered with `if` | [example-feature-flags.yml](https://github.com/mde-pach/suii/blob/main/.github/workflows/example-feature-flags.yml) | [feature-flags.yml](https://github.com/mde-pach/suii/blob/main/.github/suii/feature-flags.yml) |
| Rollout order | `rank` with `top` | [example-rollout-order.yml](https://github.com/mde-pach/suii/blob/main/.github/workflows/example-rollout-order.yml) | [rollout-order.yml](https://github.com/mde-pach/suii/blob/main/.github/suii/rollout-order.yml) |
| Weekly triage | `buckets` | [example-triage.yml](https://github.com/mde-pach/suii/blob/main/.github/workflows/example-triage.yml) | [triage.yml](https://github.com/mde-pach/suii/blob/main/.github/suii/triage.yml) |

## Alembic deployments

The migration example uses simulated data. [`examples/alembic`](https://github.com/mde-pach/suii/tree/main/examples/alembic) has the version for a real application:

- `migration_plan.py plan --json` lists the pending Alembic revisions and, for each one, the commit where the code matches that revision: the last commit before the next migration was added.
- `deploy.yml` computes the plan with a read-only database user, asks with suii, then, in a job protected by the `production` environment, re-checks the revision against the live database, checks out that commit, runs `alembic upgrade`, and deploys.

```yaml
- run: python scripts/migration_plan.py plan --json > plan.json
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL_READONLY }}

- uses: mde-pach/suii@v1
  id: ask
  with:
    template: .github/suii/choose-migration.yml
    data-file: plan.json
    forbid-self: true
```
