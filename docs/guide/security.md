# Security

An answer counts only if every edit since the last accepted state was made by an allowed person and changed nothing but checkbox marks and the order of lines within their own list.

## Who can answer

| Rule | Input | Default |
| --- | --- | --- |
| Repository role at least | `min-permission` | `write` |
| Only these people | `allowed-users` | anyone with the role |
| Only these teams | `allowed-teams` (`org/team-slug`) | anyone with the role |
| Not the person who started the run | `forbid-self` | `false` |
| Bots | always refused | |

Roles are checked with the repository's collaborator permission API and cached for the run. Team membership needs a token that can read the organization's teams; the default `GITHUB_TOKEN` cannot, so use a GitHub App token for `allowed-teams`.

For a production deployment, combine suii with a protected [environment](https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment): suii asks *what* to deploy, and the environment's required reviewers approve *that* choice before the job runs. With `forbid-self: true`, two different people are involved.

## What people can change

Values never come from the issue text. The runner keeps the mapping from each line to its value; the issue only carries checkbox marks, and the order of lines in `rank` and `buckets` fields. So:

- adding an option, rewording a label or editing the intro is detected and reverted;
- a crafted line in your data, such as `- [ ] **Submit**`, cannot become a checkbox: values are escaped, and lines are read by position anyway;
- outputs can only be values your template defined.

## What suii does not protect

- **Visibility.** Issues in a public repository are public. Never put secrets in a template or in data. Use `issue-repo` to ask in a private repository.
- **The decision itself.** suii records who answered; it does not judge the answer. Keep checks in later steps, for example re-validating a migration against the live database before running it.
- **Consumers of the outputs.** Pass outputs to scripts through `env:`, never by inlining `${{ steps.ask.outputs.x }}` in a `run:` block.

## Permissions suii needs

```yaml
permissions:
  contents: read   # check out the template
  issues: write    # create, edit, comment, close and lock the question
  actions: read    # check whether runs that left questions open still exist
```
