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

## Deploying

Runs on [Freepod](https://freepod.eu); `.freepod.json` holds the deployment
config. Ship with `freepod deploy`.

## License

[MIT](LICENSE)
