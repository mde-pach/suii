# How it works

suii runs as a normal JavaScript action. It never listens for anything: it calls the GitHub API, so it works on GitHub-hosted and self-hosted runners, with no inbound network access.

## Lifecycle

1. **Sweep.** suii closes questions left open by runs that no longer exist, for example after a lost runner.
2. **Render.** The template and data become an issue body. A bad template fails here, before any issue exists.
3. **Create the issue,** with the `suii` and `suii:pending` labels and the assignees.
4. **Poll** the issue every `poll-interval` seconds until a terminal event (below).
5. **Freeze and close.** The body becomes a read-only record (✅ / ⬜, numbered ranks, a status note), the issue is labelled, commented, closed and locked.
6. **Post hook.** If the run is cancelled or the step is killed, the post hook freezes and closes the issue as `aborted`.

## One poll

Each poll runs these checks in order and stops at the first one that decides:

| # | Check | When it fails |
| --- | --- | --- |
| 1 | Deadline reached? | `expired`, or `defaulted` with `on-timeout: default` |
| 2 | Issue changed? (conditional request with ETag) | wait for the next poll; an unchanged issue costs a 304 |
| 3 | Closed by someone? | allowed person: `cancelled`; anyone else: reopened, with a comment |
| 4 | Every edit made by an allowed person? | edit reverted, with a comment |
| 5 | Only checkbox marks or the order of lines within a list changed? | edit reverted, with a comment |
| 6 | Cancel ticked? | `cancelled` |
| 7 | Submit ticked? | wait for the next poll |
| 8 | Answer valid? | Submit unticked, with a comment saying what is missing |
| 9 | Re-read: unchanged since step 2? | evaluate again |

The order matters: who edited and what they changed are checked before Cancel or Submit are read, so an unauthorized tick can never cancel or answer.

## Who made an edit

The issue body does not say who ticked a box. suii reads the issue's edit history through the GraphQL API, and checks every edit made since the last accepted state, not just the latest one. That way an unauthorized edit followed by an authorized one is not missed. When the body changed but the history does not show the edit yet, suii waits a few polls before treating the change as unexplained and reverting it.

## Reading the form back

suii keeps the layout of the issue it rendered: which line is which option, in which list. It never parses values from the text:

- static lines (headings, intro, hints) must come back unchanged;
- each checkbox list (a `choice`, `multi` or `confirm` field, and the Submit / Cancel list) is read for its marks;
- the list of a `rank` or `buckets` field is read for its order.

GitHub lets anyone who can edit an issue drag any task-list item, Submit included, and there is no way to turn that off. So in a checkbox list the order is simply ignored: dragging "Production" above "Staging", or Cancel above Submit, changes nothing and triggers nothing. Order only means something in `rank` and `buckets` fields, where it is the answer.

What every list must keep is its own lines. An added option, a reworded label, or a line dragged into another list is tampering: the edit is reverted. After `max-reverts` rejected edits, suii gives up with `status=contested`.
