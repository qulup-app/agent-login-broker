# Agent Login Broker

**AI agents log in to websites with your [Bitwarden](https://bitwarden.com) credentials; the broker is built to keep the credentials away from the agent. Requires Bitwarden.**

English | [日本語](README.ja.md)

An [MCP](https://modelcontextprotocol.io) server (a plug-in that gives your AI agent new tools) that logs in on the agent's behalf and returns only the result. The password and one-time code are fetched through [Agent Access](https://github.com/bitwarden/agent-access) (`aac`) only when you approve it (or within an auto-approve you granted), used inside this process, and dropped. No tool returns the password, a one-time code, or the session.

> **Status: early (0.1.2). Tested on macOS only; Linux and Windows are untested.**
> It handles your passwords; read [Security and limits](#security-and-limits) before use.

## Requirements

- [Node.js](https://nodejs.org) 20 or later
- [Bitwarden CLI](https://bitwarden.com/help/cli/) (`bw`), logged in
- `aac` from [Agent Access](https://github.com/bitwarden/agent-access). Download it from the [releases page](https://github.com/bitwarden/agent-access/releases) and put it on `PATH` or in `~/.local/bin`. Required for `login` (`propose_recipe` works without it). Tested with 0.11.0; it is still pre-1.0, so a later release may break the broker.
- [Chromium](https://playwright.dev/docs/browsers) for the [Playwright](https://playwright.dev) version this package pins (see [Quick start](#quick-start))
- Optional: [herdr](https://herdr.dev), a terminal workspace manager for AI agents, and [terminal-browser](https://github.com/zenbu-labs/terminal-browser), a browser that runs in a herdr pane. They bring approvals to the front and show logged-in pages beside the agent ([herdr and terminal-browser](#herdr-and-terminal-browser)).

## Install

The plugin bundles the MCP server (run as `npx -y agent-login-broker@<version>`) and a skill that teaches the agent the login and recipe workflow.

| Agent | Install | Update |
|---|---|---|
| [Claude Code](https://code.claude.com/docs) | `claude plugin marketplace add qulup-app/agent-login-broker` then `claude plugin install agent-login-broker@agent-login-broker` | `claude plugin update agent-login-broker@agent-login-broker` |
| [Codex](https://developers.openai.com/codex) | `codex plugin marketplace add qulup-app/agent-login-broker` then `codex plugin add agent-login-broker@agent-login-broker` | `codex plugin marketplace upgrade` |
| [omp](https://omp.sh) | `omp plugin marketplace add qulup-app/agent-login-broker` then `omp plugin install agent-login-broker@agent-login-broker` | `omp plugin marketplace update` then `omp plugin upgrade` |
| [pi](https://github.com/badlogic/pi-mono) | `pi install git:github.com/qulup-app/agent-login-broker` | `pi update --extensions` |
| Any other MCP client | stdio server: command `npx`, args `["-y", "agent-login-broker@<version>"]` | change the version |

Each plugin release pins the matching [npm](https://www.npmjs.com/package/agent-login-broker) version, and the npm package ships its `npm-shrinkwrap.json`, so the dependencies are pinned too: an update never runs code you have not installed through the agent's own update command. pi runs the server from the installed package instead of npx.

## Quick start

> **You can hand the setup to your agent.** Ask it to "read https://github.com/qulup-app/agent-login-broker/blob/main/AGENT_SETUP.md and set up agent-login-broker for me". It does the steps it can and tells you the few only you can do (unlocking `aac listen`, pairing, approving).

### 1. Once

1. **Install the plugin** as in [Install](#install), then restart the agent. Its tool list (`/mcp` in Claude Code) should show `agent-login-broker`.
2. **Install Chromium.** The command is for 0.1.2; for another release, use the plugin's version (your agent's plugin list shows it). A plain `npx playwright install chromium` fetches the browser for the latest Playwright, which may not match.

   ```bash
   npx -y -p agent-login-broker@0.1.2 playwright install chromium
   ```

3. **Pair `aac`.** `aac` reads your vault through the Bitwarden CLI, so run `bw login` first.
   1. Run `aac listen`, `/unlock` the vault, then type `/pair agent-login-broker`. It shows a pairing code.
   2. In another terminal, run the line below and enter that code:

      ```bash
      read -rs AAC_TOKEN && export AAC_TOKEN && aac connect; unset AAC_TOKEN
      ```

      The code stays off the screen, out of your shell history, and off the command line `ps` shows. Processes running as your user can still read the variable while `aac connect` runs.

   The pairing is saved. Keep one pairing on this machine: with several (`aac connections list` shows them), the broker cannot tell which one to use and the login fails.
4. **Prepare Bitwarden.** Set the site's item URI to the site's host (`aac` finds the item by host), and run `bw sync` after changing an item. For a site with authenticator-app two-step login, also save the key in the item ([Two-step login](#two-step-login)).

### 2. Each login

1. Start `aac listen` and `/unlock` it. To skip this step, see [Recommended setup](#recommended-setup).
2. Ask your agent: "log in to app.example.com".
3. For a new site, the agent inspects the login page and shows you a draft **recipe** (where the login page is and which fields take the account and the password). Read it, then let the agent save it to `~/.config/agent-login-broker/recipes.json`.
4. Approve the request in `aac listen`. It waits up to 3 minutes and times out with no approval. With herdr, `aac listen` comes to the front; without it, a desktop notification appears (macOS: Notification Center; Linux: [`notify-send`](https://gitlab.gnome.org/GNOME/libnotify), when installed).
5. The agent reports `logged in to app.example.com`. Ask it to open the page (`open_page`) if you want to see it.

Keep `aac listen` running however suits you: start it in another tab right before an occasional login, keep a tab open for frequent use, or run it in [tmux](https://github.com/tmux/tmux) or [screen](https://www.gnu.org/software/screen/) to approve from SSH or several terminals.

#### When `login` fails with `aac connect failed (exit N…)`

Common exit codes (`aac --help` lists the rest):

| Exit | `aac` reports | Things to check |
|---|---|---|
| 2 | Connection failed | Is `aac listen` running and unlocked? Is this machine paired? |
| 3 | Authentication failed | Did you deny the request? Pair again if it keeps failing |
| 4 | Not found | Is there a vault item whose URI is the site's host? Did you `bw sync` after changes? |

## How it works

### Tools

| Tool | Does | Returns |
|---|---|---|
| `login(site)` | Fetches the credential with `aac connect --domain <site>` (`--id <itemId>` when the recipe names one) and logs in with a headless Chromium | `logged in to <site>`, or an error |
| `open_page(site, path?)` | Shows you the logged-in site: pages under `successPath` only | The opened URL |
| `propose_recipe(site, path?)` | Opens the login page without any credential and drafts a recipe; saves nothing | The draft and the steps to finish it |

`login` opens the recipe's login page in a headless Chromium owned by this process and fills in the form. Success means landing under the recipe's `successPath`; anything else fails closed. Chromium is driven over a pipe (no CDP port), so the agent cannot reach it.

`open_page` opens a Chromium window on this machine, or a terminal-browser pane beside the agent when terminal-browser is installed and the agent runs in herdr ([herdr and terminal-browser](#herdr-and-terminal-browser)). It hands over only the cookies the host would be sent (its own and its parent domains') and the host's localStorage. Until the page has landed, the page itself cannot move off the host (navigations and redirects elsewhere are stopped before they are sent); images, scripts and frames it loads are not stopped, and after landing the page is not held to the host. Sessions live only in this process's memory: restarting the agent means logging in again.

### Recipes

A site can be logged into only once it has a recipe. Let the agent draft one, or write it by hand. The file is reread on every login, so a new recipe needs no restart (a malformed file stops the server at startup).

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
| `successSelector` | with `successPath: "/"` | An element only a logged-in page shows (`"header [data-login]"` on GitHub); counts as logged in only while it is visible |
| `otp` | no | Selector of the one-time-code field. Without it, only an `autocomplete="one-time-code"` field is used — never a name guess |
| `otpSwitch` | no | For a site that asks for a passkey first: the link or button that switches to the authenticator-app code (on GitHub, `a[href="/sessions/two-factor/app"]`) |
| `itemId` | no | When several vault items match the site, the Bitwarden item's id. Its URI must be on the same registrable domain as the recipe's site, or the login fails before anything is typed |

To find `successPath` or `otpSwitch`, log in once: a failed login names the page it landed on, its inputs' types and names (never values), and the links beside it. `propose_recipe` drafts only a page that shows the password field; `login` also handles a site that asks for the password on a second page of the same host. A form on another host is unsupported.

### Two-step login

Only the six-digit code from an authenticator app (TOTP) is supported. Save the site's key (the secret behind the QR code you scan when turning on two-step login) in the item's "Authenticator key" field, and the broker computes the code itself (Bitwarden's [guide](https://bitwarden.com/help/integrated-authenticator/)). Storing the key is free; whether `aac` hands it over on a free account has not been tested. If `login` reports no authenticator key although you saved one, that plan limit is the likely cause.

Codes sent by SMS or email, push approvals and passkeys cannot be answered. A site that asks for a passkey first but also offers an authenticator code works with `otpSwitch`.

### CAPTCHAs and bot checks

No recipe gets past [reCAPTCHA](https://developers.google.com/recaptcha), [hCaptcha](https://www.hcaptcha.com), Cloudflare's [Turnstile](https://developers.cloudflare.com/turnstile/) or challenge, or [Arkose](https://www.arkoselabs.com). When the broker sees one it stops and opens the login page where `open_page` would (terminal-browser, or a Chromium window) so you can log in yourself. A check already on the login form stops it before any credential is requested.

Google (any `google.*` site) is refused outright: right after the account step it answers an automated browser with a "this browser may not be secure" page.

## Going further

### herdr and terminal-browser

With [herdr](https://herdr.dev) and terminal-browser installed:

- **Approvals**: run `aac listen` in a herdr workspace labelled `aac-listen`. On each request the broker focuses that workspace, shows a notification, and returns you to where you were once it is answered (unless you moved meanwhile).
- **`open_page`**: splits a terminal-browser pane next to the agent's herdr pane, one window per agent pane, reused until you close it. **The agent can drive this page through `terminal-browser action`** (not the Chromium window).
- **When the pane is unknown**: an agent outside herdr, and the Codex plugin (Codex does not pass the agent's herdr pane to plugin MCP servers), get a Chromium window. In [HTTP mode](#http-mode) without the pane header, the page opens beside `aac-listen`.
- Point `AGENT_LOGIN_BROKER_TERMINAL_BROWSER` at a nonexistent path to always use the Chromium window.

### Recommended setup

Approvals are the easiest thing to miss. Run your agents inside herdr and start `aac listen` in the `aac-listen` workspace whenever you start an agent: you unlock it once, and it comes to the front on each login. A shell function that wraps your agent command is enough (zsh or bash, needs [`jq`](https://jqlang.org)):

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

### Desktop apps

The Claude and Codex desktop apps run the server like any other MCP client. Two things differ:

- `aac listen` still needs a terminal (it is interactive and asks for `/unlock` each time it starts). Keep one terminal window running it; waiting requests show a desktop notification, so it can stay in the background.
- A desktop app may not see your shell's `PATH`. If the server does not start, use the absolute path of `npx` (from `which npx`) as the command.

The commands under [Install](#install) are for the command-line tools; installing from inside the desktop apps has not been tested.

### HTTP mode

Advanced; a normal setup does not need it. `agent-login-broker --http <port>` serves Streamable HTTP on `127.0.0.1` only, for clients that cannot spawn the server themselves (e.g. an agent in a container).

- Callers send the token from `~/.config/agent-login-broker/token` (created 0600 on first start) in the `X-Agent-Login-Broker-Token` header. It keeps other local processes and containers from driving the tools; it is not a secret from the agent that uses them.
- Optionally, the `X-Agent-Login-Broker-Pane` header carries the caller's herdr pane id (its `HERDR_PANE_ID`, e.g. `w1:p2`), so `open_page` opens next to that agent. Anything that is not a pane id is ignored.
- Accepted `Host` headers: `127.0.0.1`, `localhost`, `host.docker.internal`. From a container this works where `host.docker.internal` reaches the host's loopback (verified with [OrbStack](https://orbstack.dev)); on Linux [Docker](https://www.docker.com) it is expected not to (not tested).
- The server does not reread its environment: restart it after changing `AGENT_LOGIN_BROKER_SITES`.

### Configuration

| Variable | Meaning |
|---|---|
| `AGENT_LOGIN_BROKER_RECIPES` | Recipes file (default `~/.config/agent-login-broker/recipes.json`). Every site in it can be logged into |
| `AGENT_LOGIN_BROKER_SITES` | Optional comma-separated hosts: when set, only these may be logged into or drafted. Set but empty allows none |
| `AGENT_LOGIN_BROKER_AAC` | Path to `aac` (else `~/.local/bin/aac`, then `aac` on `PATH`) |
| `AGENT_LOGIN_BROKER_HERDR` | Path to `herdr` (default `herdr`) |
| `AGENT_LOGIN_BROKER_TERMINAL_BROWSER` | Path to `terminal-browser` (default `terminal-browser`) |
| `AGENT_LOGIN_BROKER_NOTIFY` | `off` turns off the desktop notification for a waiting request |
| `AGENT_LOGIN_BROKER_TOKEN_FILE` | HTTP mode caller token (default `~/.config/agent-login-broker/token`) |

## Security and limits

### What it protects

- **The password and one-time codes are kept out of the agent's conversation, tool output and logs.** A failed login whose error contains them (as typed, or URL-encoded) returns a generic error instead; a page that re-encodes them some other way (base64, say) is not caught.
- **Every credential fetch goes through approval in `aac listen`**, except while an auto-approve you granted there covers it.
- **The broker opens and types into `https://<site>` pages only.** The session stays in this process until you `open_page` it.

### What it does not protect

- **Approval requests you did not make.** The agent runs as your user, so it can run `aac connect` itself with the pairing in `~/.access-protocol/`, and the prompt looks the same as the broker's. **Deny every approval request you did not just ask for**, and keep auto-approve (`[a]`, N minutes) short.
- **The page's scripts.** The password is typed into the site's page, so the page's own scripts and the third-party ones it loads (analytics, ads, CDNs) can read it and send it anywhere — exactly as when you log in by hand.
- **Recipe edits.** The agent can write the recipes file, so it can add a site or change which field receives the password; an agent steered by a malicious page could pick a field that publishes it. Read every recipe change before you approve the next login, and set `AGENT_LOGIN_BROKER_SITES` for a fixed list the agent cannot extend.
- **Pages `propose_recipe` opens.** Without `AGENT_LOGIN_BROKER_SITES`, the agent can open any public HTTPS login page in the broker's browser (no credential is used). Internal names and private addresses are refused, and while the page loads, navigations and redirects off the host are stopped; but a public name that resolves to a private address is not detected, and images, scripts and frames the page loads can reach any address, internal ones included.
- **Sessions handed to terminal-browser.** The agent can use them too — anything that page can do (on a brokerage, placing orders), the agent can. Do not `open_page` sites where that is dangerous. Whatever you type into a login page opened in terminal-browser after a bot check, your password included, is readable by the agent; it is told not to touch the page, but if that is not enough for a site, log in from your usual browser. A Chromium window is out of the agent's reach.
- **Network traffic.** `server.mjs` opens no connection off this machine (besides the local HTTP mode server, it only connects over loopback to terminal-browser's browser) and sends no telemetry. What leaves the machine is the broker's Chromium loading the site and everything its pages load, and `aac` fetching the credential through Bitwarden's relay (`wss://ap.lesspassword.dev` by default); how that relay handles it is described by Bitwarden, not here.

## Terms, license and reporting

- **Terms of use**: logging in through an automated browser may break a site's terms of service (Google blocks it outright). Checking the terms and using this tool within them is your responsibility. Use it only for accounts you own or are authorized to use: logging into someone else's account can be unlawful.
- **Not affiliated**: this project is not affiliated with or endorsed by Bitwarden, GitHub, Google, Cloudflare or any other company named here. Their names are used only to describe compatibility.
- **Reporting security issues**: do not open a public issue for a vulnerability. Report it privately through [GitHub's vulnerability reporting](https://github.com/qulup-app/agent-login-broker/security/advisories/new).
- **License**: MIT, see [LICENSE](LICENSE). No warranty; use it at your own risk. It can lead to a leaked credential, a locked account, or unwanted actions on a site it logged into, and as the [LICENSE](LICENSE) states, the authors are not liable for damages from its use. Dependencies are installed by npm under their own licenses (all permissive: MIT, ISC, Apache-2.0, BSD); none is bundled in this package.

## Development

```bash
npm ci
npm test
```

`flake.nix` provides Node: `nix build .#default --out-link .nix/node` (the out-link is a GC root).
