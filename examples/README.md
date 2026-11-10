# Examples

Runnable examples live in this repository's [`.github/workflows`](../.github/workflows) (`example-*.yml`) with their templates in [`.github/suii`](../.github/suii). Run one from the **Actions** tab and answer the issue it opens.

| Example | Field types | Workflow | Template |
| --- | --- | --- | --- |
| Choose a migration | `choice`, `confirm`, generated options, disabled options | [example-migration.yml](../.github/workflows/example-migration.yml) | [choose-migration.yml](../.github/suii/choose-migration.yml) |
| Release checklist | `choice` with a default, required `confirm` | [example-release-checklist.yml](../.github/workflows/example-release-checklist.yml) | [release-checklist.yml](../.github/suii/release-checklist.yml) |
| Feature flags | `multi` with `min` / `max`, filtered options | [example-feature-flags.yml](../.github/workflows/example-feature-flags.yml) | [feature-flags.yml](../.github/suii/feature-flags.yml) |
| Rollout order | `rank` with `top` | [example-rollout-order.yml](../.github/workflows/example-rollout-order.yml) | [rollout-order.yml](../.github/suii/rollout-order.yml) |
| Weekly triage | `buckets` | [example-triage.yml](../.github/workflows/example-triage.yml) | [triage.yml](../.github/suii/triage.yml) |

## Alembic deployments

[`alembic/`](alembic) is the full version of the migration example for a real application: `migration_plan.py` finds the pending Alembic revisions and the code commit that matches each one, and `deploy.yml` asks with suii, then migrates and deploys behind a protected environment.
