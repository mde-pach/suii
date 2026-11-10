# Field types

suii only uses what GitHub issues support natively: checkboxes that can be ticked in place, and task-list items that can be reordered by drag and drop.

Each field gets the controls it needs and no others:

- `choice`, `multi`, `confirm`, and the Submit / Cancel list can be ticked but not dragged. Each list opens with a plain line (its hint), and GitHub does not make a list draggable when it contains a line without a checkbox.
- `rank` and `buckets` can be dragged but not ticked. GitHub only makes a line draggable when it has a checkbox, so those lines show one, but suii unticks it at once.

| Type | How people answer | Output |
| --- | --- | --- |
| `choice` | tick exactly one option | the option's value, e.g. `prod` |
| `multi` | tick any number of options | JSON array, e.g. `["a","c"]` |
| `confirm` | tick one box | `true` or `false` |
| `rank` | drag options into order | JSON array in the chosen order |
| `buckets` | drag options under group headings | JSON object of arrays, by group id |

## `choice`

Pick one. Required by default (`required: false` allows no answer, which outputs an empty string). At most one option can have `default: true`.

```yaml
- id: environment
  type: choice
  label: Environment
  options:
    - { label: Staging, value: staging, default: true }
    - { label: Production, value: prod }
```

## `multi`

Pick several. `min` and `max` bound the count; `required: true` without `min` means at least one.

```yaml
- id: flags
  type: multi
  label: Flags to enable
  min: 1
  max: 3
  options: [new-checkout, smart-search, bulk-export]
```

## `confirm`

A single checkbox. With `required: true` it must be ticked before the answer is accepted, which makes checklists. `default: true` pre-ticks it.

```yaml
- id: backups
  type: confirm
  label: A database backup was taken today
  required: true
```

## `rank`

People drag the items into order with the ⠿ handle GitHub shows to the left of each checkbox. GitHub only lets a line be dragged when it has a checkbox, so the boxes are there, but they cannot be ticked: suii unticks them at once. With `top: 3`, only the first three are output.

```yaml
- id: regions
  type: rank
  label: Rollout order
  top: 3
  options: [eu-west, us-east, ap-south, sa-east]
```

Output: `["us-east","eu-west","ap-south"]`.

::: tip
Drag and drop works on github.com in a browser. Test it in the GitHub mobile app before relying on `rank` or `buckets` for people who answer from their phone; checkboxes work everywhere.
:::

## `buckets`

Sort items into groups. Each group is a bold heading line in one list; people drag items under the heading they belong to. Items start in their option's `bucket`, or the first group.

```yaml
- id: triage
  type: buckets
  label: Issues
  buckets:
    - { id: this-week, label: This week }
    - { id: backlog, label: Backlog }
    - { id: close, label: Close }
  options:
    from: data.issues
    label: "{{ item.title }}"
    value: "{{ item.number }}"
    bucket: backlog
```

Output: `{"this-week":["101"],"backlog":["103","104"],"close":["105"]}`. An item dragged above the first heading belongs to no group, and the answer is refused until it is moved.

## Disabled options

`disabled` options are shown struck through, without a checkbox, so they cannot be picked but people can see why they are missing. `rank` and `buckets` leave disabled options out.
