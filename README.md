# Agent Login Broker

**AI agents log in with your [Bitwarden](https://bitwarden.com) credentials; the broker never hands the credentials to the agent. Requires Bitwarden.**

English | [日本語](README.ja.md)

An [MCP](https://modelcontextprotocol.io) server (a plug-in that gives your AI agent new
tools) that logs the agent into websites with your username and password — without the agent
ever seeing them. Each credential is fetched from Bitwarden through
[Agent Access](https://github.com/bitwarden/agent-access) (`aac`) once you approve it there
(or within an auto-approve you granted), used inside this process, and dropped. Tools return results only: never the
password, never a one-time code, never the session.

For each site, the broker needs a **recipe**: a few lines saying where the login page is and
which fields take the account and the password. Your agent drafts it for you and shows it to
you before saving.

> **Status: early (0.1.0).** It handles your passwords; read
> [What it protects, and what it does not](#what-it-protects-and-what-it-does-not) before use.
> Tested on macOS only; Linux and Windows are untested.

## Requirements

- [Node.js](https://nodejs.org) 20 or later
- [Bitwarden CLI](https://bitwarden.com/help/cli/) (`bw`), logged in
- `aac` from [bitwarden/agent-access](https://github.com/bitwarden/agent-access), paired
  with this machine (below). **Required for `login`**, so without it no site can be logged
  into (`propose_recipe` uses no credential and works without it). It is looked up
  as `$AGENT_LOGIN_BROKER_AAC`, then `~/.local/bin/aac`, then `aac` on `PATH`. Tested with
  `aac` 0.11.0; `aac` is still pre-1.0, so a later release may change what the broker relies on.
- [Chromium](https://playwright.dev/docs/browsers) for the [Playwright](https://playwright.dev) version this package pins (see [Quick start](#quick-start))
- Optional: [herdr](https://herdr.dev), a terminal workspace manager for AI agents, together
  with [terminal-browser](https://github.com/zenbu-labs/terminal-browser), a browser that runs in a herdr pane. They bring approvals to the
  front and show logged-in pages beside the agent ([herdr integration](#herdr-integration)).
  Install terminal-browser only together with herdr: on its own, `open_page` fails.

## Quick start

1. Install the plugin for your agent ([Install](#install)), then restart the agent. Its tool
   list (`/mcp` in Claude Code) should now show `agent-login-broker`.
2. Install the Chromium build this release expects. The command below is for 0.1.0; for
   another release, use the plugin's version (your agent's plugin list shows it):

   ```bash
   npx -y -p agent-login-broker@0.1.0 playwright install chromium
   ```

   A plain `npx playwright install chromium` fetches the browser for the latest Playwright,
   which may not match the one pinned here.
3. Pair `aac` with this machine once ([Pairing and approving](#pairing-and-approving)).
4. Make sure the site's login is saved in Bitwarden with the site's address as its URI
   (`aac` finds the item by that host), then run `bw sync`. If the site uses two-step login
   with an authenticator app, also save its key in the item
   ([Two-step login](#two-step-login-one-time-codes)).
5. Start `aac listen` and `/unlock` it, then ask your agent: "log in to app.example.com". The
   first time, it drafts a recipe and shows it to you; read it and let it save it to
   `~/.config/agent-login-broker/recipes.json`. Then approve the request in `aac listen`.
   The agent reports `logged in to app.example.com`; ask it to open the page if you want to
   see it.

For a setup where you never have to remember step 5's `aac listen`, see
[Recommended setup](#recommended-setup). Using the Claude or Codex desktop app instead of a
terminal? See [Desktop apps](#desktop-apps).

You can also hand the whole setup to your agent: ask it to "read
https://github.com/qulup-app/agent-login-broker/blob/main/AGENT_SETUP.md and set up
agent-login-broker for me". It does the steps it can and tells you the few only you can do
(unlocking `aac listen`, pairing, approving).

## Install

The plugin bundles the MCP server (run as `npx -y agent-login-broker@<version>`) and a skill
that teaches the agent the login and recipe workflow.

| Agent | Install | Update |
|---|---|---|
| [Claude Code](https://code.claude.com/docs) | `claude plugin marketplace add qulup-app/agent-login-broker` then `claude plugin install agent-login-broker@agent-login-broker` | `claude plugin update agent-login-broker@agent-login-broker` |
| [Codex](https://developers.openai.com/codex) | `codex plugin marketplace add qulup-app/agent-login-broker` then `codex plugin add agent-login-broker@agent-login-broker` | `codex plugin marketplace upgrade` |
| [omp](https://omp.sh) | `omp plugin marketplace add qulup-app/agent-login-broker` then `omp plugin install agent-login-broker@agent-login-broker` | `omp plugin marketplace update` then `omp plugin upgrade` |
| [pi](https://github.com/badlogic/pi-mono) | `pi install git:github.com/qulup-app/agent-login-broker` | `pi update --extensions` |
| Any other MCP client | stdio server: command `npx`, args `["-y", "agent-login-broker@<version>"]` | change the version |

Each plugin release pins the matching [npm](https://www.npmjs.com/package/agent-login-broker) version, and the npm package ships its
`npm-shrinkwrap.json`, so the dependencies are pinned too: an update never runs code you have
not installed through the agent's own update command. pi runs the server from the installed
package instead of npx.

## Pairing and approving

`aac` is the Agent Access CLI. Download it from the
[releases page](https://github.com/bitwarden/agent-access/releases) and put it on `PATH` or in
`~/.local/bin`. It reads your vault through the Bitwarden CLI, so log that in first
(`bw login`, once).

Then pair once:

1. Run `aac listen` and type `/unlock` to unlock your vault.
2. Type `/pair agent-login-broker`. It shows a pairing code.
3. In another terminal, run the line below and enter that code:

   ```bash
   read -rs AAC_TOKEN && export AAC_TOKEN && aac connect; unset AAC_TOKEN
   ```

   (`read -rs` keeps the code off the screen and out of your shell history, and `aac` reads
   it from the `AAC_TOKEN` variable, so it is not on the command line that `ps` shows either.
   Processes running as your user can still read that variable while `aac connect` runs.)

The pairing is saved, so later logins need only a running, unlocked `aac listen`. Keep one
pairing on this machine: with several (`aac connections list` shows them), `aac` cannot tell
which one the broker means and the login fails.

Every login waits up to 3 minutes for you to approve it in `aac listen`; with no approval by
then, it times out. `aac listen` only has to be running when you ask the agent to log in;
pick whichever fits:

| How | Effort | Suits |
|---|---|---|
| Start `aac listen` in another tab and `/unlock` right before asking for a login | One step each time | Occasional use |
| Keep one terminal tab with `aac listen` open | Once per session | Frequent use |
| Run it inside [tmux](https://github.com/tmux/tmux) or [screen](https://www.gnu.org/software/screen/) | Once | Approving from SSH or several terminals |

Without herdr, a waiting request shows a desktop notification (macOS: Notification Center;
Linux: [`notify-send`](https://gitlab.gnome.org/GNOME/libnotify), when installed). With herdr, the broker also brings `aac listen` to the
front ([herdr integration](#herdr-integration)).

When `login` fails with `aac connect failed (exit N…)`, the common exit codes are (`aac --help`
lists the rest):

| Exit | `aac` reports | Things to check |
|---|---|---|
| 2 | Connection failed | Is `aac listen` running and unlocked? Is this machine paired? |
| 3 | Authentication failed | Did you deny the request? Pair again if it keeps failing |
| 4 | Not found | Is there a vault item whose URI is the site's host? Run `bw sync` after changes |

## Configuration

| Variable | Meaning |
|---|---|
| `AGENT_LOGIN_BROKER_RECIPES` | Recipes file (default `~/.config/agent-login-broker/recipes.json`). Every site in it can be logged into. |
| `AGENT_LOGIN_BROKER_SITES` | Optional comma-separated hosts: when set, only these may be logged into or drafted. Set but empty allows none. |
| `AGENT_LOGIN_BROKER_AAC` | Path to `aac` |
| `AGENT_LOGIN_BROKER_HERDR` | Path to `herdr` (default `herdr`) |
| `AGENT_LOGIN_BROKER_TERMINAL_BROWSER` | Path to `terminal-browser` (default `terminal-browser`) |
| `AGENT_LOGIN_BROKER_NOTIFY` | `off` turns off the desktop notification for a waiting request |
| `AGENT_LOGIN_BROKER_TOKEN_FILE` | HTTP mode caller token (default `~/.config/agent-login-broker/token`) |

The Bitwarden item for a site must match the host (`aac connect --domain <site>`). `aac`
reads Bitwarden CLI's local copy; run `bw sync` after changing an item in the app.

## How it logs in

A headless Chromium owned by this process opens the recipe's login page and fills in the
form. If a one-time-code field appears (the recipe's `otp` selector, else only
`autocomplete="one-time-code"` — never a name guess), the code is generated from the item's
authenticator key (TOTP). Success means landing under the recipe's `successPath`; anything
else fails closed. **Because the password is typed into the page, the page's own scripts —
the site and any third-party analytics on it — can read it**, exactly as when you log in by
hand. Chromium is driven over a pipe (no CDP port), so the agent cannot reach it.

### Two-step login (one-time codes)

Many sites ask for a second step after the password (two-step login, 2FA). This tool answers
one kind: the six-digit code from an authenticator app, called a TOTP. It can type that code
only if the item holds the site's **authenticator key**: the secret behind the QR code you
scan when you turn on two-step login. Save it in the item's "Authenticator key" field
(Bitwarden's [guide](https://bitwarden.com/help/integrated-authenticator/)). The broker
computes the code from the key itself.

Storing the key is free in Bitwarden; showing codes in Bitwarden's own apps needs Premium or a
paid organization. Whether `aac` hands the key over on a free account has not been tested; if
`login` reports that the item has no authenticator key although you saved one, that plan
limit is the likely cause.

Codes sent by SMS or email, push approvals in an app, and passkeys cannot be answered. A
site that asks for a passkey first but also offers an authenticator code works with the
recipe's `otpSwitch`.

### CAPTCHAs and bot checks

No recipe can get past a CAPTCHA or a Cloudflare challenge ([reCAPTCHA](https://developers.google.com/recaptcha),
[hCaptcha](https://www.hcaptcha.com), [Turnstile](https://developers.cloudflare.com/turnstile/),
[Arkose](https://www.arkoselabs.com)). When the broker sees one:

- It stops. A check already on the login form stops it before any credential is requested.
- It opens the login page where `open_page` would (terminal-browser, else a Chromium window)
  so you can log in there yourself, and tells the agent so.

`propose_recipe` checks before drafting; `login` checks on the form and after a failed login.

### Recipes

A site can be logged into only once it has a recipe:

```json
{
  "app.example.com": {
    "loginPath": "/login",
    "username": "input[name=\"email\"]",
    "password": "input[name=\"password\"]",
    "successPath": "/dashboard",
    "otp": "input[name=\"code\"]"
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `loginPath` | yes | Path of the login page (a query string is allowed) |
| `username`, `password` | yes | CSS selectors of the account and password fields |
| `successPath` | yes | Path the site always lands on after a login, normally below `/`. Use `"/"` only together with `successSelector`, for a site that lands on `/` (GitHub does) |
| `successSelector` | with `successPath: "/"` | An element only a logged-in page shows (`"header [data-login]"` on GitHub). The login, and every `open_page`, counts as logged in only while it is visible; `open_page` may then open any page of the site |
| `otp` | no | Selector of the one-time-code field |
| `otpSwitch` | no | For an account whose site asks for a passkey first: the link or button that switches to the authenticator-app code (on GitHub, `a[href="/sessions/two-factor/app"]`), clicked when no code field shows |
| `itemId` | no | When several vault items match the site (two accounts on one service), the Bitwarden item's id. See below |

With `itemId`, the broker asks `aac connect --id` for that item instead of `--domain`. The
item's own URI must still be on the recipe's site, or the login fails before anything is
typed. "On the site" means the same registrable domain, as in Bitwarden's base-domain match:
an item saved for `www.example.com` serves `accounts.example.com`.

To find `successPath` or `otpSwitch`, log in once: a failed login names the page it landed
on, the names/types (never values) of that page's inputs, and the links beside it. The file
is read at startup (a malformed one stops the server) and again on every `login`, so a new
recipe needs no restart.

You do not have to write recipes by hand: ask your agent to log in, and when `login` reports
no recipe it calls `propose_recipe`, which opens the login page without any credential and
drafts the fields. **Read the draft before saving it** — a recipe decides which field
receives your password, and an agent steered by a malicious page could pick a field that
publishes it. `propose_recipe` drafts only a page that shows the password field; `login`
also handles a site that asks for the account and then the password on a second page of the
same host. A form on another host is reported as unsupported.

Google (any `google.*` site) is refused outright: it answers an automated browser with a
"this browser may not be secure" page right after the account step, whoever presses the
button. The tools say so and point to Google's own APIs or a normal browser instead.

## Tools

| Tool | Does | Returns |
|---|---|---|
| `login(site)` | Fetches the credential with `aac connect --domain <site>` (`--id <itemId>` when the recipe names one) and logs in as above | `logged in to <site>`, or an error |
| `open_page(site, path?)` | Shows the logged-in site to you: pages under `successPath` only | The opened URL |
| `propose_recipe(site, path?)` | Opens the login page (no credential) and drafts a recipe; saves nothing | The draft and the steps to finish it |

What `open_page` does:

- It opens a Chromium window on this machine, or a terminal-browser pane when terminal-browser
  is installed.
- It hands over only the host's session state: the cookies the host itself would be sent (its
  own and its parent domains') and its localStorage.
- Until the page has landed, the page itself cannot move off the host: navigations and
  redirects elsewhere are stopped before they are sent. Images, scripts and frames the page
  loads are not stopped.

The broker's sessions live only in this process's memory: restarting the agent (and with it
the server) means logging in again.

## Desktop apps

The Claude and Codex desktop apps run the server like any other MCP client. Two things differ
from a terminal setup:

- `aac listen` still needs a terminal: it is interactive and asks for `/unlock` each time it
  starts. Keep one Terminal window running it. One way to start it with your Mac (not tested
  here; names may differ by macOS version): a Terminal profile whose shell runs `aac listen`
  at startup, opened by a login item. Waiting requests show a desktop notification, so the
  window can stay in the background.
- A desktop app may not see your shell's `PATH`. If the server does not start, use the
  absolute path of `npx` (from `which npx`) as the command.

The install commands under [Install](#install) are for the command-line tools; installing
from inside the desktop apps has not been tested yet.

## Recommended setup

Approvals are easiest to miss, so the setup that works best runs `aac listen` for you and
brings it to the front when a login needs it:

1. Run your agents inside [herdr](https://herdr.dev), with
   [terminal-browser](#herdr-integration) installed for `open_page`.
2. Start `aac listen` in a herdr workspace labelled `aac-listen` whenever you start an agent,
   so it is always there. You unlock it once; it outlives the agent.

For step 2, a shell function that wraps your agent command is enough (zsh or bash, needs
[`jq`](https://jqlang.org)):

```bash
# Make sure `aac listen` runs in the herdr workspace "aac-listen": create the workspace if it
# is missing, and start the listener again if the workspace is there but it has stopped.
aac_listen_ensure() {
  local ws pane
  ws=$(herdr workspace list | jq -r '.result.workspaces[] | select(.label == "aac-listen") | .workspace_id' | head -n 1)
  if [ -n "$ws" ]; then
    pane=$(herdr pane list --workspace "$ws" | jq -r '[.result.panes[] | select(.label == null)][0].pane_id // empty')
    herdr pane process-info --pane "$pane" |
      jq -e '.result.process_info.foreground_processes[]? | select(.name == "aac" and .argv[1] == "listen")' >/dev/null && return
  else
    pane=$(herdr workspace create --label aac-listen --no-focus | jq -r '.result.root_pane.pane_id // empty')
  fi
  [ -n "$pane" ] && herdr pane run "$pane" "aac listen"
}
claude() { aac_listen_ensure; command claude "$@"; }   # likewise for codex, omp, pi
```

Then, on each login, the broker switches herdr to `aac-listen` with a notification and
switches back once you answer, and `open_page` opens the logged-in site in a pane beside the
agent.

## herdr integration

With [herdr](https://herdr.dev) and terminal-browser installed:

- Run `aac listen` in a herdr workspace labelled `aac-listen`. On each credential request
  the broker focuses that workspace, shows a notification, and returns you to where you
  were once the request is answered (unless you moved meanwhile). Without herdr you get a
  desktop notification instead (see [Pairing and approving](#pairing-and-approving)).
- `open_page` splits a terminal-browser pane next to the agent's herdr pane (or next to
  `aac-listen` when the server has no pane of its own) and reuses that one window. **The
  agent can drive this page through `terminal-browser action`**, unlike the Chromium window.
  Once `terminal-browser` is on `PATH`, `open_page` always takes this route: outside herdr
  (no agent pane and no `aac-listen` workspace) it fails instead of falling back to the
  Chromium window. Point `AGENT_LOGIN_BROKER_TERMINAL_BROWSER` at a nonexistent path to force
  the Chromium window.

## HTTP mode

Advanced; a normal setup does not need it. `agent-login-broker --http <port>` serves
Streamable HTTP on `127.0.0.1` only, for clients that cannot spawn the server themselves
(e.g. an agent in a container).

- Callers must send the `X-Agent-Login-Broker-Token` header with the token from
  `~/.config/agent-login-broker/token` (created 0600 on first start). The token keeps other
  local processes and containers from driving the tools; it is not a secret from the agent
  that uses them.
- Accepted `Host` headers: `127.0.0.1`, `localhost`, `host.docker.internal`. From a container
  this works where `host.docker.internal` reaches the host's loopback (verified with
  [OrbStack](https://orbstack.dev)). On Linux [Docker](https://www.docker.com) it points at the bridge gateway, so a loopback-only server is
  expected to be unreachable (not tested).
- The server does not reread its environment: restart it after changing
  `AGENT_LOGIN_BROKER_SITES` (recipes are reread on every login).

## What it protects, and what it does not

- Protected: the password and one-time codes are kept out of the agent's conversation,
  tool output, or logs. A failed login whose error contains them (as typed, or URL-encoded,
  e.g. a page that copies the password into its URL) returns a generic error instead; a page
  that re-encodes them some other way is not caught. Each credential fetch goes through
  `aac listen`: it waits for you to approve it, except while an auto-approve you granted
  there covers it (below). Logins go only to `https://<site>`. The session stays in this
  process until you `open_page` it.
- Not protected: the agent runs as your user, so it can run `aac connect` itself with the
  pairing in `~/.access-protocol/`. The approval prompt then looks the same as the broker's,
  so **deny every approval request you did not just ask for**. Keep `aac listen`'s
  auto-approve (`[a]`, N minutes) short: meanwhile, repeat requests for the same site pass
  unasked.
- The recipes file is writable by the agent, so it can add a site or change which field
  receives the password. Read every recipe change before you approve the next login, and
  set `AGENT_LOGIN_BROKER_SITES` if you want a fixed list the agent cannot extend through the file.
- Without `AGENT_LOGIN_BROKER_SITES`, the agent can make `propose_recipe` open any public HTTPS
  login page in the broker's browser (no credential is used). Internal names and private
  addresses are refused and redirects off the host are stopped, but a public name that
  resolves to a private address is not detected, and only the page itself is held to the
  host: images, scripts and frames it loads can reach any address, internal ones included.
- After login, the agent gets whatever the tools allow. A session handed to terminal-browser
  is usable by the agent too — anything that page can do (on a brokerage, placing orders),
  the agent can. Do not `open_page` sites where that is dangerous.
- The login page shown after a bot check is in that same terminal-browser, so whatever you
  type there — your password included — is readable by the agent. The agent is told not to
  touch the page; if that is not enough for a site, log in from your usual browser instead.
- Typing the password into the site's page means it is not held to the site: the page's own
  scripts and the third-party ones it loads (analytics, ads, CDNs) can read it and send it
  anywhere ([How it logs in](#how-it-logs-in)). "Logins go only to `https://<site>`" above
  means the broker opens and types into that host's page only.
- Network traffic: `server.mjs` opens no connection off this machine (besides the local HTTP
  mode server, it only connects over loopback to terminal-browser's browser) and sends no
  telemetry. What leaves the machine is the
  broker's Chromium loading the site and everything that site's pages load, and `aac`
  fetching the credential through Bitwarden's relay (`wss://ap.lesspassword.dev` by
  default); how that relay handles it is described by Bitwarden, not here.

## Terms of use and trademarks

Logging in through an automated browser may break a site's terms of service; some sites
forbid it, and Google blocks it outright. Checking a site's terms and using this tool within
them is your responsibility. Use it only for accounts you own or are authorized to use:
logging into someone else's account can be unlawful.

This project is not affiliated with or endorsed by Bitwarden, GitHub, Google, Cloudflare or
any other company named here. Their names are used only to describe compatibility.

## Reporting security issues

Do not open a public issue for a vulnerability. Report it privately through
[GitHub's vulnerability reporting](https://github.com/qulup-app/agent-login-broker/security/advisories/new)
so it can be fixed before it is public.

## Development

```bash
npm ci
npm test
```

`flake.nix` provides Node: `nix build .#default --out-link .nix/node` (the out-link is a GC root).

## License

MIT, see [LICENSE](LICENSE). The software comes with no warranty. Use it at your own risk: it
can lead to a leaked credential, a locked account, or unwanted actions on a site it logged
into, and as the [LICENSE](LICENSE) states, the authors are not liable for damages from its
use. Dependencies are installed by npm under their own licenses (all permissive: MIT, ISC,
Apache-2.0, BSD); none is bundled in this package.
