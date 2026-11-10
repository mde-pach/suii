---
layout: home

hero:
  name: suii
  text: Ask a question in the middle of a workflow
  tagline: A GitHub Action that pauses a step, opens an issue form people answer by ticking boxes, and hands their answer to the next steps as outputs.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: See the examples
      link: /examples

features:
  - title: Nothing exposed
    details: The runner only calls the GitHub API. No tunnel, no public URL, no third-party service. Who may answer is your repository's own permissions.
  - title: Dynamic choices
    details: Options come from data your earlier steps compute, such as pending database migrations, feature flags or open issues.
  - title: Five field types
    details: Pick one, pick several, confirm, rank by dragging, or sort into groups by dragging. All native GitHub, including on mobile for checkboxes.
  - title: Tamper-proof
    details: Values never come from the issue text. Every edit's author is checked, and any edit other than ticking or dragging is reverted.
---

## What it looks like

```yaml
- uses: mde-pach/suii@v1
  id: ask
  with:
    template: .github/suii/choose-migration.yml
    data-file: plan.json

- run: alembic upgrade "$REVISION"
  env:
    REVISION: ${{ steps.ask.outputs.revision }}
```

The step opens an issue like this one, and waits:

```markdown
> [!NOTE]
> Requested by @alice · [Deploy #42](…) · answer before 2026-11-10 15:12 UTC

### Target migration
<sub>Pick one · required</sub>

- [ ] `8c2d4e6f1a3b` add orders table · code `1a2b3c4d`
- [ ] `b7e1f0a9c8d2` add index on orders.created_at · code `2b3c4d5e`
- ~~`4d5e6f7a8b9c` backfill order totals~~ · *unavailable*

---

- [ ] **Deploy**
- [ ] Cancel the deployment
```

Someone with write access ticks an option and **Deploy**. suii checks who did it, closes the issue as a record of the decision, and the workflow continues with `revision` set.
