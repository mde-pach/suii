# Slack

suii can tell a Slack channel that a question is waiting, with a button to the issue, and report how it ended. The answer itself stays on GitHub: Slack messages carry the title, the link and the outcome, never the values.

There are two ways to connect. Both are optional, and a Slack failure never fails the step: it is logged as a warning.

| | Incoming webhook | Bot token |
| --- | --- | --- |
| Setup | one webhook URL | a Slack app with `chat:write`, invited to the channel |
| When the question opens | a message with an **Answer on GitHub** button | the same |
| When it closes | a second message with the outcome | the first message is updated in place (struck-through title, outcome), plus a reply in its thread |
| Inputs | `slack-webhook-url` | `slack-bot-token`, `slack-channel` |

## With an incoming webhook

1. In Slack, create an app at [api.slack.com/apps](https://api.slack.com/apps), turn on **Incoming Webhooks**, and add a webhook for your channel.
2. Store the URL as a repository secret, for example `SLACK_WEBHOOK_URL`.
3. Pass it to suii:

```yaml
- uses: mde-pach/suii@v1
  with:
    template: .github/suii/release.yml
    slack-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
    slack-mention: "<!here>"
```

## With a bot token

1. In your Slack app, add the `chat:write` bot scope, install it, and copy the **Bot User OAuth Token** (`xoxb-…`).
2. Invite the bot to the channel (`/invite @your-app`).
3. Store the token as a secret and pass it with the channel:

```yaml
- uses: mde-pach/suii@v1
  with:
    template: .github/suii/release.yml
    slack-bot-token: ${{ secrets.SLACK_BOT_TOKEN }}
    slack-channel: C0123ABCD        # a channel ID, or #name
    slack-mention: "<!subteam^S0123ABC>"
```

## Mentions

`slack-mention` is put before the opening message, so the right people get a Slack notification:

| Mention | Text |
| --- | --- |
| Everyone active in the channel | `<!here>` |
| One person | `<@U0123ABC>` (their member ID) |
| A user group | `<!subteam^S0123ABC>` |

## What the messages say

When the question opens: its title, a link to the issue, who started the run, the deadline, and buttons to the issue and the workflow run.

When it closes: ✅ answered by someone, 🛑 cancelled, ⏱️ expired (or default values used), ⚠️ stopped after rejected edits or an error, or 🛑 aborted when the run was cancelled. Aborted runs are reported by suii's post hook.
