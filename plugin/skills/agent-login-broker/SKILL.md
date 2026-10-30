---
name: agent-login-broker
description: Use when the user asks to log in to a website, open a page that needs a login, or set up a site for agent-login-broker. Logs in through the broker so you never see or type the password.
---

# Logging in with agent-login-broker

The `agent-login-broker` MCP server logs in for you with a credential from the user's
Bitwarden vault. You never see the password, and you must not ask for it or type it into
any browser yourself, not even when a login fails.

## Log in

1. Tell the user an approval request may appear in `aac listen` and to approve it there. Do
   this before step 2: once the site has a recipe, `login` does not return until they approve
   or 3 minutes pass, so you cannot tell them meanwhile. (A site without a recipe returns at
   once with no request; see below.)
2. Call `login(site)` with the bare host, e.g. `app.example.com`.
3. On success, call `open_page(site, path?)` if the user wants to see the logged-in page.
   If `login` (or `propose_recipe`) reports a bot check, it has already opened the login page
   for the user: tell them to log in there themselves, and do not read, snapshot or drive
   that page meanwhile.

## When `login` reports no recipe

A recipe tells the broker where the login form is. Make one with the user:

1. Call `propose_recipe(site)`. If it reports no password field, find the login page
   (e.g. `/login`, `/signin`) and call it again with that `path`.
2. Show the draft to the user and wait for their approval. The recipe decides which field
   receives the password: never save one the user has not seen.
3. Set `successPath`: ask the user which path the site shows right after logging in, or
   use `"/unknown"` for now.
4. Merge the recipe into the recipes file (`$AGENT_LOGIN_BROKER_RECIPES`, default
   `~/.config/agent-login-broker/recipes.json`): a JSON object of host -> recipe. Keep the other
   entries.
5. Call `login(site)` again. No restart is needed. If `successPath` was `"/unknown"`, the
   login fails and names the path it landed on: put that path in the recipe after the user
   confirms it, then log in again. If it lands on `/`, set `successPath` to `"/"` and add
   `successSelector`: an element only a logged-in page shows, checked with the user.
6. If the login stops on a passkey page, add `otpSwitch`: pick the switch to an authenticator
   code from the `links:` the error lists, with the user.
7. If the vault holds several items for the site (two accounts), the login is denied: ask
   the user for the item's id and add it as `itemId`.

## What not to do

- Do not use a browser tool to fill in a login form for a site the broker can handle.
- Do not edit a recipe's `username`, `password` or `otp` selectors without showing the
  user the change.
- If an approval request appears that the user did not just ask for, tell them to deny it.
