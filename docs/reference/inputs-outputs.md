# Inputs and outputs

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `template` | required | Path to the template YAML, relative to the workspace, or the template as inline YAML. |
| `data` | `{}` | JSON available to the template as `data`. |
| `data-file` | | Path to a JSON file for `data`; takes precedence over `data`. |
| `vars` | | `key=value` lines available as `vars`. |
| `timeout` | `900` | Seconds to wait. Keep it below the step's `timeout-minutes`. |
| `poll-interval` | `10` | Seconds between checks. |
| `min-permission` | `write` | `read`, `triage`, `write`, `maintain` or `admin`. |
| `allowed-users` | | Comma or newline separated logins. |
| `allowed-teams` | | Comma or newline separated `org/team-slug`. Needs a token that can read teams. |
| `forbid-self` | `false` | The run's actor cannot answer. |
| `assignees` | | Logins assigned to the issue, so they are notified. |
| `labels` | | Extra labels for the issue. |
| `issue-repo` | current repo | `owner/repo` where the issue is created. Needs a token for that repository. |
| `on-timeout` | `fail` | `default`: use each field's default value when nobody answered. |
| `on-cancel` | `fail` | `continue`: succeed with `status=cancelled` so later steps can branch. |
| `on-empty` | `skip` | `fail`: fail when a required field has no option, instead of succeeding with `status=empty`. |
| `max-reverts` | `5` | Rejected edits tolerated before `status=contested`. |
| `lock` | `true` | Lock the conversation once the issue is closed. |
| `slack-webhook-url` | | Slack incoming webhook; see [Slack](/guide/slack). |
| `slack-bot-token` | | Slack bot token (`chat:write`), used with `slack-channel`. |
| `slack-channel` | | Channel ID or `#name` for `slack-bot-token`. |
| `slack-mention` | | Put before the opening message, e.g. `<!here>`. |
| `github-token` | `github.token` | Token used for every API call. |

## Outputs

| Output | Description |
| --- | --- |
| `status` | `answered`, `defaulted`, `cancelled`, `expired`, `contested`, `empty` or `error`. See [outcomes](/reference/outcomes). |
| `values` | JSON object with every field's value. |
| `<field id>` | One output per field: a string for `choice`, `true`/`false` for `confirm`, JSON for `multi`, `rank` and `buckets`. |
| `responder` | Login of the person who submitted (or cancelled). |
| `answered-at` | ISO timestamp of the accepted answer. |
| `issue-number` | Number of the issue. |
| `issue-url` | URL of the issue. |

## Labels

suii creates its labels on first use: `suii` on every question, `suii:pending` while waiting, then one of `suii:answered`, `suii:cancelled`, `suii:expired`, `suii:contested`, `suii:aborted` or `suii:error`.
