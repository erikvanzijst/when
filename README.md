# When?

Find the date that works for everyone. Pick a few dates, share one link, and
watch the votes come in live.

Live at **https://when.prutser.freepod.eu**.

> This app was slopped: built end to end by an AI coding assistant (Claude Code)
> from a short brief and a round of questions, with no hand-written code.
> Review accordingly.

## Features

- Sign in with Freepod; anyone with the link can view results
- Create a datepicker from calendar days with optional times; its name becomes
  the permalink
- Single- or multiple-choice voting; change your vote any time
- Live vote bars with voter names and Gravatars, updated over Server-Sent Events
- Owner tools: edit, close/reopen, pick a final date (with `.ics` export), delete
- Copy-link / native share, plus Open Graph preview images for link unfurls
- Email notifications when others vote: on by default for the creator,
  opt-in for everyone else, debounced so a burst of changes becomes one email

## Stack

Node.js with `pg` and a vanilla JS frontend, with no build step. The schema
is created at startup. Preview images are rendered with satori + resvg.

## Running locally

```sh
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/when DEV_AUTH=1 PORT=8080 node server.js
```

`DEV_AUTH=1` enables a fake sign-in for development: visit
`/dev/login?u=alice&n=Alice` (add `&e=<email>` to test Gravatars).

## Notification settings

Set with `freepod var set KEY=value`. All are optional.

| Variable | Default | Purpose |
|---|---|---|
| `MAIL_TRANSPORT` | `smtp` | `smtp`, `file` (writes to `var/outbox/`, for local dev) or `off` |
| `SMTP_HOST` | `smtp.mailer.svc.cluster.local` | Mail relay |
| `SMTP_PORT` | `25` | |
| `SMTP_SECURE` | unset | `1` for implicit TLS |
| `SMTP_USER`, `SMTP_PASS` | unset | Relay credentials, if required (set the password with `--secret`) |
| `MAIL_FROM` | `When <when@freepod.eu>` | Sender |
| `APP_URL` | `https://` + hostname from `.freepod.json` | Base for links in emails |
| `NOTIFY_DEBOUNCE_SECONDS` | `60` | Quiet time after a voter's last change before emailing |
| `NOTIFY_MAX_DELAY_SECONDS` | `300` | Upper bound, so constant changes still get reported |
| `UNSUBSCRIBE_SECRET` | generated, stored in the database | HMAC key for unsubscribe links |

Preview the email design with `node scripts/preview-emails.js`, then open
`var/email-previews/index.html`.

## Deploying

Runs on [Freepod](https://freepod.eu); `.freepod.json` holds the deployment
config. Ship with `freepod deploy`.

## License

[MIT](LICENSE)
