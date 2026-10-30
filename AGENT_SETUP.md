# Setting up agent-login-broker (instructions for an AI agent)

You are helping a user set up agent-login-broker: an MCP server that logs you into websites
with the user's Bitwarden credentials without you ever seeing them. Follow these steps in
order. Do what you can yourself; for the steps marked **user**, tell the user exactly what to
do and wait for them to confirm.

## Rules for the whole setup

- Never ask for, read, or type the user's master password, a site password, a one-time code,
  or the `aac` pairing token. Those steps are always the user's.
- Do not run `bw` or `aac` yourself beyond `--version`/`--help`; some setups block it, and the
  pairing and unlock steps need the user anyway.
- Before running a command that installs software, show it and get the user's go-ahead.
- If a step fails, report the exact error and stop that step; do not work around it with a
  browser login.

## 1. Check the machine

Run and report:

```bash
node --version          # 20 or later
npx --version
bw --version            # Bitwarden CLI
aac --version           # Agent Access
command -v herdr terminal-browser jq
```

- No Node 20+: tell the user to install it (for example from https://nodejs.org).
- No `bw`: tell the user to install the Bitwarden CLI (https://bitwarden.com/help/cli/) and run
  `bw login` themselves (**user**: it asks for their master password).
- No `aac`: tell the user to install it from https://github.com/bitwarden/agent-access and put
  it on `PATH` or in `~/.local/bin`.
- herdr, terminal-browser and jq are optional; note whether they are there for step 6.

## 2. Install the plugin for the agent you are

Use the row for your own harness (the user can confirm which one):

| Agent | Commands |
|---|---|
| Claude Code | `claude plugin marketplace add qulup-app/agent-login-broker` then `claude plugin install agent-login-broker@agent-login-broker` |
| Codex | `codex plugin marketplace add qulup-app/agent-login-broker` then `codex plugin add agent-login-broker@agent-login-broker` |
| omp | `omp plugin marketplace add qulup-app/agent-login-broker` then `omp plugin install agent-login-broker@agent-login-broker` |
| pi | `pi install git:github.com/qulup-app/agent-login-broker` |
| Other MCP clients | Add a stdio server named `agent-login-broker`: command `npx`, args `["-y", "agent-login-broker@<version>"]` |
| Claude or Codex desktop app | Run the matching command-line row above if that CLI is installed. Otherwise add the stdio server as in "Other MCP clients", with the absolute path of `npx` (`which npx`) as the command; desktop apps may not see the shell's `PATH` |

Note the installed version (your agent's plugin list shows it). The new tools usually appear
only after the agent restarts; tell the user so.

## 3. Install the matching Chromium

Replace `0.1.0` with the version from step 2:

```bash
npx -y -p agent-login-broker@0.1.0 playwright install chromium
```

Do not use a plain `npx playwright install chromium`: it may fetch a browser for a different
Playwright version.

## 4. Pair aac (user)

Tell the user to do this once, in their own terminal:

1. Run `aac listen`, type `/unlock`, then `/pair agent-login-broker`.
2. In another terminal, run the line below and enter the pairing token from `/pair`:

   ```bash
   read -rs AAC_TOKEN && export AAC_TOKEN && aac connect; unset AAC_TOKEN
   ```

Wait for them to say it worked.

## 5. Explain how approvals work (user)

Tell the user, in their language:

- Every login goes through `aac listen` and waits for their approval there (unless an
  auto-approve they granted covers it), so it must be running and unlocked when they ask you
  to log in. Unless herdr brings it to the front, the broker tries a desktop notification
  (macOS, or Linux with `notify-send`); if none appears, watch the `aac listen` window.
- Approve only requests they just asked for; deny any other.
- `aac listen`'s auto-approve (`[a]`) lets repeat requests for the same site through without
  asking; keep it short.

## 6. Make approvals hard to miss (optional)

- herdr is installed and the user starts agents from a shell: offer the `aac_listen_ensure`
  function from the README's "Recommended setup" section, adapted to their shell and agent
  command. Show the change to their shell startup file and get their go-ahead before editing.
- The user works in the Claude or Codex desktop app: point them to the README's "Desktop apps"
  section (a terminal window running `aac listen` is still needed).
- Otherwise: suggest keeping one terminal tab with `aac listen` open.

## 7. Try it

1. Ask the user which site to try first, and confirm its login is saved in Bitwarden (**user**:
   `bw sync` after adding or changing an item).
2. Tell the user an approval request may appear in `aac listen`, then call `login(site)`.
3. If it reports no recipe, call `propose_recipe(site)`, show the draft to the user, and save it
   to the recipes file only after they approve it (see the README's "Recipes" section). Then
   call `login(site)` again.
4. On success, offer `open_page(site)`.

Finish with a short summary for the user: what was installed, where the recipes file is, and
what they need to have running (`aac listen`) next time.
