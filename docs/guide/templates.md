# Templates

A template is a YAML file with a `title`, an optional `intro`, a list of `fields`, and optional `submit` and `cancel` labels. Text is rendered with [Liquid](https://liquidjs.com/), so it can use data computed by earlier steps.

```yaml
title: "Deploy {{ vars.environment }}: choose the migration"
intro: |
  The database is at {{ data.current | code }}.
fields:
  - id: revision
    type: choice
    label: Target migration
    options:
      from: data.plan
      label: "{{ item.revision | code }} {{ item.message }}"
      value: "{{ item.revision }}"
      disabled: item.deployable == false
submit: Deploy          # default: Submit
cancel: Cancel the run  # default: Cancel; `false` hides it
```

## What a template can read

| Name | Contents |
| --- | --- |
| `data` | The JSON from the `data` or `data-file` input. |
| `vars` | The `key=value` lines from the `vars` input. |
| `run` | `repo`, `workflow`, `id`, `number`, `attempt`, `actor`, `event`, `ref`, `sha`, `job`, `url` of the current run. |
| `item`, `index` | Inside generated options: the current array element and its position. |

Environment variables are deliberately not available, so a template can never put a secret into an issue.

## Escaping

The template file is trusted: it is written and reviewed in your repository. Values interpolated with `{{ }}` are not: they are escaped, so they cannot add lines, checkboxes, @mentions or issue links to the form.

| Filter | Result |
| --- | --- |
| `{{ value }}` | Escaped text, on one line. |
| `{{ value \| code }}` | An inline code span, safe whatever the value contains. |
| `{{ value \| short }}` | The first 7 characters (`short: 10` for 10), for commit SHAs. |
| `{{ value \| raw }}` | Not escaped. Only use it for values you control. |

All standard Liquid tags and filters work, such as `{% if %}`, `size`, `prepend` or `upcase`.

## Fields

Every field has an `id` (lowercase, used as the output name), a `type`, and a `label`. It can also have a `description` and `required`. See [field types](/guide/field-types) for each type's options and output.

## Options

Options are a static list, either strings or mappings:

```yaml
options:
  - staging                                  # label and value "staging"
  - { label: Production, value: prod, default: true }
  - { label: Moon, value: moon, disabled: true }
```

Or they are generated from an array in the context with `from`:

```yaml
options:
  from: data.flags
  if: item.enabled == false        # skip some items
  label: "{{ item.key | code }} {{ item.description }}"
  value: "{{ item.key }}"
  default: item.recommended        # pre-tick
  disabled: item.locked            # show, but cannot be picked
  limit: 50                        # keep the issue readable
```

`if`, `default` and `disabled` take a boolean, a Liquid condition (`item.size > 3`), or a template that renders `true` / `false`.

Labels must be unique within a field: after a drag and drop, a line is recognised by its text. Values must be unique too.

## Validation

A template is checked when the step starts, before any issue exists. The step fails with a clear message on invalid YAML, a missing or duplicate field id, an unknown type, a generated option that renders an empty or duplicate value, or an issue body over 60,000 characters.

When a required field has no option to pick, for example no pending migration, the form is *empty*. By default suii then succeeds with `status=empty` without opening an issue; set `on-empty: fail` to fail instead.
