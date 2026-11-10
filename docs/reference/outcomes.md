# Outcomes

Every run ends with exactly one `status`. Except `empty`, each one leaves the issue closed, frozen into a record and labelled.

| `status` | When | Issue | Step |
| --- | --- | --- | --- |
| `answered` | Submit ticked by an allowed person, every field valid | closed as completed, `suii:answered` | succeeds |
| `defaulted` | timeout reached, `on-timeout: default`, every required field has a default | closed as completed, `suii:expired` | succeeds |
| `cancelled` | Cancel ticked, or the issue closed, by an allowed person | closed as not planned, `suii:cancelled` | fails; succeeds with `on-cancel: continue` |
| `expired` | timeout reached without a valid answer | closed as not planned, `suii:expired` | fails |
| `contested` | more than `max-reverts` rejected edits | closed as not planned, `suii:contested` | fails |
| `empty` | a required field has nothing to pick | no issue is created | succeeds; fails with `on-empty: fail` |
| `error` | the GitHub API kept failing, or the issue was deleted | closed if possible, `suii:error` | fails |

Two more endings happen outside the step:

- **The run is cancelled, or the step is killed** by `timeout-minutes`: the post hook closes the issue as `suii:aborted`.
- **The runner is lost** and no post hook runs: the next suii step in the repository closes the issue as `suii:aborted` during its sweep.

Events that do not end the wait:

- **Submit with an incomplete answer:** Submit is unticked and a comment lists what is missing.
- **Closed by someone who cannot answer:** the issue is reopened, with a comment.
- **An edit by someone who cannot answer, or an edit that changes more than checkboxes:** reverted, with a comment.

## Branching on the status

```yaml
- uses: mde-pach/suii@v1
  id: ask
  with:
    template: .github/suii/release.yml
    on-cancel: continue

- if: steps.ask.outputs.status == 'answered'
  run: ./ship.sh

- if: steps.ask.outputs.status == 'cancelled'
  run: echo "Release stopped by @${{ steps.ask.outputs.responder }}"
```
