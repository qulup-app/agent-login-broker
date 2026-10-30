#!/usr/bin/env node
// MCP server that logs into an allow-listed site, by a recipe describing its login form, with
// a credential fetched from Bitwarden through Agent Access (`aac connect`). The credential
// lives only in this process: no tool returns it, an error that contains it (as typed or
// URL-encoded) is replaced, and the session stays in a browser the agent has no handle on
// until the human opens it with open_page.
import { execFile } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { getDomain, getDomainWithoutSuffix } from "tldts";

const LOCAL_AAC = `${process.env.HOME}/.local/bin/aac`;
// aac's releases are a bare binary, conventionally dropped in ~/.local/bin, which MCP
// clients often leave off the PATH they start servers with.
const AAC = process.env.AGENT_LOGIN_BROKER_AAC || (existsSync(LOCAL_AAC) ? LOCAL_AAC : "aac");
const CONFIG_DIR = `${process.env.HOME}/.config/agent-login-broker`;
// Each fetch waits for a human to approve it in `aac listen`.
const APPROVAL_TIMEOUT_MS = 180_000;
const VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// AGENT_LOGIN_BROKER_SITES narrows the sites further. Unset, there is no list: a site with no recipe
// cannot be logged into anyway, and the human still approves each credential by host. Set but
// empty means no site at all, as it always has.
export function allowedSites(env = process.env.AGENT_LOGIN_BROKER_SITES) {
  if (env === undefined) return null;
  return new Set(env.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export function checkSite(site, allowed) {
  const host = String(site).trim().toLowerCase();
  let parsed;
  try { parsed = new URL(`https://${host}/`).host; } catch {}
  // Anything but a bare host, optionally with a port (a path, userinfo), would not name one site.
  if (!host || parsed !== host) throw new Error(`not a host name: ${host}`);
  // Google answers an automated browser with /v3/signin/rejected right after the account step,
  // whoever clicks; hiding the automation would be bot-detection evasion that breaks again.
  if (getDomainWithoutSuffix(host) === "google") {
    throw new Error(`Google rejects sign-in from automated browsers, so ${host} cannot be logged into here. ` +
      "Tell the user to use Google's own APIs with OAuth (Gmail, Calendar, Drive) or a tool built on them, " +
      "or to sign in themselves in their usual browser. Do not try another browser tool.");
  }
  if (allowed && !allowed.has(host)) throw new Error(`site not allowed: ${host}`);
  return host;
}

// Names that only reach inside a network. Without AGENT_LOGIN_BROKER_SITES any agent request can
// point propose_recipe's browser at a host, so these are refused there. ponytail: a public
// name that resolves to a private address is not caught; set AGENT_LOGIN_BROKER_SITES if that matters.
export function isInternalHost(host) {
  const name = host.replace(/:\d+$/, "").replace(/\.+$/, "");
  if (name.startsWith("[") || !name.includes(".") || /\.(localhost|local|internal|lan|home\.arpa)$/.test(name)) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(name)) return false;
  const [a, b] = name.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// A URL counts as the site only over https on the exact host and without userinfo:
// `https://u:p@host/` would hand whatever credentials it carries to the browser.
export function onSite(url, host) {
  const u = new URL(url);
  return u.protocol === "https:" && u.host === host && !u.username && !u.password;
}

// Errors name the failure, never echo stdout: on success it holds the password.
// `forHost` is set when the item was named by id rather than looked up by domain: then
// nothing but the item's own uri says it belongs to this site. Same registrable domain, as
// Bitwarden's own base-domain match (www.google.com's item serves accounts.google.com); the
// Public Suffix List with its private part keeps a.co.jp from b.co.jp and alice.github.io
// from bob.github.io, which a last-two-labels rule would join.
export function parseCredential(stdout, forHost) {
  let out;
  try {
    out = JSON.parse(stdout);
  } catch {
    throw new Error("aac returned unreadable output");
  }
  if (!out?.success) throw new Error("credential request was denied or failed");
  const { username, password, totp, uri } = out.credential ?? {};
  if (!username || !password) throw new Error("credential has no username or password");
  if (forHost) {
    let itemHost;
    try { itemHost = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : `https://${uri}`).host; } catch {}
    const site = (h) => getDomain(h, { allowPrivateDomains: true });
    if (!uri || !itemHost || (itemHost !== forHost && (!site(itemHost) || site(itemHost) !== site(forHost)))) {
      throw new Error(`the vault item named by itemId is not for ${forHost}`);
    }
  }
  return { username, password, totp: totp || null };
}

function base32(s) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.toUpperCase().replace(/[\s=-]/g, "")) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error("authenticator key is not base32");
    bits += v.toString(2).padStart(5, "0");
  }
  return Buffer.from(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []);
}

// RFC 6238 code from the item's authenticator key, which Bitwarden stores either as a bare
// base32 secret or as an otpauth:// URI (with optional digits / period / algorithm).
export function totpCode(key, now = Date.now()) {
  let secret = key, digits = 6, period = 30, algorithm = "sha1";
  if (key.startsWith("otpauth://")) {
    const q = new URL(key).searchParams;
    secret = q.get("secret") ?? "";
    digits = Number(q.get("digits") ?? 6);
    period = Number(q.get("period") ?? 30);
    algorithm = (q.get("algorithm") ?? "SHA1").toLowerCase();
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const mac = createHmac(algorithm, base32(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 0x0f;
  const n = (mac.readUInt32BE(o) & 0x7fffffff) % 10 ** digits;
  return String(n).padStart(digits, "0");
}

const run = (cmd, args, env) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 15_000, env }, (err, stdout) => resolve(err ? null : stdout));
});

const HERDR = process.env.AGENT_LOGIN_BROKER_HERDR || "herdr";

const focusedWorkspace = async () => {
  try {
    return JSON.parse(await run(HERDR, ["workspace", "list"])).result.workspaces.find((w) => w.focused)?.workspace_id ?? null;
  } catch {
    return null;
  }
};

// The herdr workspace labelled "aac-listen" (where the human runs `aac listen`) and its first pane.
async function approverWorkspace() {
  try {
    const ws = JSON.parse(await run(HERDR, ["workspace", "list"])).result.workspaces
      .find((w) => w.label === "aac-listen")?.workspace_id;
    if (!ws) return null;
    const panes = JSON.parse(await run(HERDR, ["pane", "list", "--workspace", ws])).result.panes;
    return { ws, pane: panes.find((p) => p.label == null)?.pane_id };
  } catch {
    return null;
  }
}

// Without herdr the request still waits in `aac listen`; a desktop notification is the only
// way to tell a human who is not looking at it. Best effort: no notifier, no notification.
function notifyDesktop(host) {
  if (process.env.AGENT_LOGIN_BROKER_NOTIFY === "off") return;
  const text = `Approve in aac listen: ${host}`;
  if (process.platform === "darwin") {
    // The text goes in as an argument, never into the script source.
    run("osascript", ["-e", "on run argv", "-e",
      'display notification (item 1 of argv) with title "agent-login-broker" sound name "Glass"', "-e", "end run", text]);
  } else if (process.platform === "linux") {
    run("notify-send", ["agent-login-broker", text]);
  }
}

// Bring the approver to the `aac listen` pane so the request is seen at once, including
// from a remote herdr client, and return a function that brings them back once the request
// is answered. Best effort: without herdr the request still waits there.
async function summonApprover(host) {
  const a = await approverWorkspace();
  if (!a) {
    notifyDesktop(host);
    return async () => {};
  }
  const from = await focusedWorkspace();
  await run(HERDR, ["workspace", "focus", a.ws]);
  await run(HERDR, ["notification", "show", "agent-login-broker", "--body", `Approve in aac listen: ${host}`, "--sound", "request"]);
  return async () => {
    // Only if the human is still on aac-listen: if they moved elsewhere meanwhile, leave them.
    if (from && from !== a.ws && (await focusedWorkspace()) === a.ws) {
      await run(HERDR, ["workspace", "focus", from]);
    }
  };
}

// stdout is read only when it says success is false and carries no credential, and then
// only its error field: a credential's values exist nowhere else in the output.
export function aacReason(stdout, stderr) {
  let reason = stderr.trim().split("\n")[0];
  try {
    const out = JSON.parse(stdout);
    if (out?.success === false && out.credential === undefined) reason = String(out.error?.message ?? out.error ?? "") || reason;
  } catch {}
  return reason ? `: ${reason.slice(0, 200)}` : "";
}

async function fetchCredential(host, itemId) {
  const restore = await summonApprover(host);
  try {
    return await new Promise((resolve, reject) => {
      // aac gives up after its own --timeout (120 s unless set); ask it for the same three
      // minutes, and keep our kill a little later so its own message is the one reported.
      execFile(AAC, ["connect", ...(itemId ? ["--id", itemId] : ["--domain", host]), "--output", "json",
        "--timeout", String(APPROVAL_TIMEOUT_MS / 1000)],
        { timeout: APPROVAL_TIMEOUT_MS + 10_000, maxBuffer: 1 << 20 },
        (err, stdout, stderr) => {
          if (err) return reject(new Error(err.killed
            ? "no approval in aac listen within 3 minutes"
            : `aac connect failed (exit ${err.code}${aacReason(stdout, stderr)})`));
          try { resolve(parseCredential(stdout, itemId && host)); } catch (e) { reject(e); }
        });
    });
  } finally {
    await restore();
  }
}

// `base` itself or below it, on a segment boundary (`/home` admits `/home/x`, not
// `/home-error`). Encoded slashes / backslashes are refused outright: a server may decode
// them into a different path than the one checked.
export function underPath(pathname, base) {
  if (/%2f|%5c/i.test(pathname)) return false;
  const root = base.replace(/\/+$/, "");
  return pathname === root || pathname.startsWith(`${root}/`);
}

// The login form of each allowed site, filled from the user's recipes file at startup. The
// broker drives its own headless Chromium to fill it in.
export const RECIPES = {};

// "/" or "" as successPath would make every page on the host count as logged in: "/" is
// accepted only with a successSelector, which then carries the success signal instead.
const BELOW_ROOT = /^\/[^/]/;
const nonBlank = (v) => typeof v === "string" && v.trim() !== "";
const successPathOk = (r) => BELOW_ROOT.test(r?.successPath ?? "") || (r?.successPath === "/" && nonBlank(r.successSelector));

// Logged in by the recipe's signal, the same for login and open_page: on the host, off the
// login form (by path, unless it sits at "/" where every page would match, and by its
// password field showing), no code field showing, under the success path, and the success
// selector visible when there is one.
const showsLoggedIn = async (page, host, recipe) => {
  if (!onSite(page.url(), host)) return false;
  const { pathname } = new URL(page.url());
  const loginPathname = recipe.loginPath.split("?")[0];
  if (loginPathname !== "/" && underPath(pathname, loginPathname)) return false;
  for (const field of [recipe.password, recipe.otp ?? STANDARD_OTP_FIELD]) {
    if (await page.isVisible(field).catch(() => false)) return false;
  }
  return underPath(pathname, recipe.successPath) &&
    (recipe.successSelector === undefined || await page.isVisible(recipe.successSelector).catch(() => false));
};

// A missing file means no extra recipes; anything malformed stops the server at startup
// rather than at the first login.
export function loadRecipes(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${path}: expected an object of host -> recipe`);
  const recipes = {};
  for (const [host, r] of Object.entries(raw)) {
    const bad = ["username", "password"].filter((k) => typeof r?.[k] !== "string" || !r[k].trim());
    if (r?.otp !== undefined && (typeof r.otp !== "string" || !r.otp.trim())) bad.push("otp");
    if (r?.itemId !== undefined && !nonBlank(r.itemId)) bad.push("itemId");
    if (r?.otpSwitch !== undefined && !nonBlank(r.otpSwitch)) bad.push("otpSwitch");
    if (typeof r?.loginPath !== "string" || !r.loginPath.startsWith("/")) bad.push("loginPath");
    if (r?.successSelector !== undefined && !nonBlank(r.successSelector)) bad.push("successSelector");
    else if (!successPathOk(r)) bad.push("successPath");
    if (bad.length) throw new Error(`${path}: recipe for ${host} has a missing or invalid ${bad.join(", ")}`);
    recipes[host.trim().toLowerCase()] = r;
  }
  return recipes;
}

// The one-time-code field: the recipe's own selector, else only the standard marker. Never a
// name guess — `name*="code"` would also match a zipcode box and type a code into it.
const STANDARD_OTP_FIELD = 'input[autocomplete="one-time-code"]';

// A challenge only a human can pass. Checked when the form shows and when a login fails, so
// it never decides a success. reCAPTCHA's invisible badge sits on ordinary login pages, and
// hCaptcha's frame URL carries "recaptchacompat", so reCAPTCHA is matched by its path only.
// ponytail: known providers only; a site's home-grown challenge reads as a plain failure.
const BOT_CHECKS = [
  ["reCAPTCHA", 'iframe[src*="/recaptcha/"]:not([src*="size=invisible"])'],
  ["hCaptcha", 'iframe[src*="hcaptcha.com"]'],
  ["Cloudflare Turnstile", 'iframe[src*="challenges.cloudflare.com"]'],
  ["Cloudflare challenge", "#challenge-form, #challenge-running, #cf-challenge-running"],
  ["Arkose", 'iframe[src*="arkoselabs"], iframe[src*="funcaptcha"]'],
];
async function botCheck(page) {
  for (const [name, selector] of BOT_CHECKS) {
    if (await page.isVisible(selector).catch(() => false)) return name;
  }
  return null;
}
const BOT_CHECK_ANY = BOT_CHECKS.map(([, selector]) => selector).join(", ");
const botStop = (name) => Object.assign(new Error(`the site shows a bot check (${name})`), { botCheck: name });

// Names/types of the inputs on a page, never their values: what a new recipe needs to pick
// its selectors when the login does not complete.
const describeInputs = (page) =>
  page.$$eval("input:not([type=hidden])", (els) => els.slice(0, 6)
    .map((e) => `${e.type}${e.name ? `[name=${e.name}]` : ""}${e.autocomplete ? `[autocomplete=${e.autocomplete}]` : ""}`)
    .join(" ")).catch(() => "");

// Same-host links beside the landed page (its parent path), paths only: where a passkey
// page offers the switch to a code, for a recipe's otpSwitch.
const describeLinks = (page) =>
  page.$$eval("a[href]", (els) => {
    const dir = location.pathname.replace(/[^/]*$/, "");
    const paths = els.map((a) => new URL(a.href)).filter((u) => u.host === location.host && u.pathname !== location.pathname && u.pathname.startsWith(dir)).map((u) => u.pathname);
    return [...new Set(paths)].slice(0, 8).join(" ");
  }).catch(() => "");

let chromiumBrowser;
const browserSessions = new Map(); // host -> logged-in BrowserContext of the broker's Chromium

// Typing into a page means the page's own scripts — first and third party — can read the
// field, exactly as when a human logs in: a direct form POST would avoid that, but most
// login forms today are drawn and submitted by JavaScript. What stays closed: the agent has
// no handle on this Chromium (Playwright drives it over a pipe, no CDP port), fields are
// filled only while the page is still https on the host, and no tool returns the session
// or the page until open_page hands it to the human.
// `prepare` lets the tests route the site to local fixtures before the page loads.
export async function loginWithBrowser(host, recipe, { prepare } = {}) {
  if (!successPathOk(recipe)) throw new Error(`recipe for ${host} needs a successPath below "/" (or "/" with a successSelector)`);
  const { chromium } = await import("playwright");
  chromiumBrowser ??= await chromium.launch({ headless: true });
  const context = await chromiumBrowser.newContext();
  let page;
  // Every value typed into the page, to keep it out of the error returned to the agent:
  // Playwright's call log quotes what fill() typed, and the page can copy it into the path or
  // a field name that a failed login reports. Held to the end, not dropped with cred, for that.
  // shortcut: catches the value as typed or URL-encoded only, not a page that re-encodes it
  // (base64 etc.); returning no page-derived text at all would close that too.
  const typed = [];
  try {
    await prepare?.(context);
    page = await context.newPage();
    const loginPathname = recipe.loginPath.split("?")[0];
    const onLoginPage = () => onSite(page.url(), host) && new URL(page.url()).pathname.startsWith(loginPathname);
    await page.goto(`https://${host}${recipe.loginPath}`);
    // A form showing only the account field asks for the password on a page of its own.
    await Promise.any([recipe.password, recipe.username].map((f) => page.waitForSelector(f, { state: "visible", timeout: 30_000 })))
      .catch(() => { throw new Error("login form not found on the expected host"); });
    if (!onSite(page.url(), host)) throw new Error("login form not found on the expected host");
    // Following the redirect would leave showsLoggedIn, and open_page after it, excluding a
    // login path the form is not on.
    if (!onLoginPage()) throw new Error(`loginPath redirects to ${new URL(page.url()).pathname}; set loginPath to that path`);
    const twoStep = !(await page.isVisible(recipe.password));
    const atForm = await botCheck(page);
    if (atForm) throw botStop(atForm);

    let cred = await fetchCredential(host, recipe.itemId);
    typed.push(cred.username, cred.password);
    try {
      if (!onLoginPage()) throw new Error("page left the login form while waiting for approval");
      const afterApproval = await botCheck(page);
      if (afterApproval) throw botStop(afterApproval);
      // A host check before each fill could not stop a redirect that lands between it and the fill.
      await onlyOnHost(page, host, async () => {
        await page.fill(recipe.username, cred.username);
        if (twoStep) {
          await page.press(recipe.username, "Enter");
          await page.waitForSelector(recipe.password, { state: "visible", timeout: 30_000 }).catch(async () => {
            throw new Error(`no password field after the account step (on ${new URL(page.url()).host}${new URL(page.url()).pathname}; inputs: ${await describeInputs(page)})`);
          });
          // The password page may sit on another path, never on another host.
          if (!onSite(page.url(), host)) throw new Error("the password page is not on the expected host");
        }
        await page.fill(recipe.password, cred.password);
        await page.press(recipe.password, "Enter");
      });

      // Leaving the login path is not proof of success: the one-time code step can live on
      // a different path. Wait for either signal, then look for the code field once more.
      const otpField = recipe.otp ?? STANDARD_OTP_FIELD;
      const offLogin = (u) => !(u.host === host && u.pathname.startsWith(loginPathname));
      const otpVisible = (timeout) =>
        page.waitForSelector(otpField, { state: "visible", timeout }).then(() => true, () => false);
      // The password field going away is the sign that works when the form sits at "/",
      // where no URL is ever off the login path.
      await Promise.race([
        page.waitForURL(offLogin, { timeout: 30_000 }).catch(() => {}),
        page.waitForSelector(recipe.password, { state: "hidden", timeout: 30_000 }).catch(() => {}),
        otpVisible(30_000),
      ]);
      // A passkey challenge has no code field; the recipe's otpSwitch moves to the code page.
      let switched = false;
      // Whichever shows first decides: waiting out the code field's timeout on a page that
      // offers the switch cost 3 s on every passkey login (measured on GitHub).
      const firstShown = !recipe.otpSwitch ? null : await Promise.race([
        otpVisible(3_000).then((v) => (v ? "code" : null)),
        page.waitForSelector(recipe.otpSwitch, { state: "attached", timeout: 3_000 }).then(() => "switch", () => null),
      ]);
      if (firstShown === "switch" && onSite(page.url(), host) && !(await page.isVisible(otpField))) {
        // A link is followed by its href (pages fold it into a closed "more options" that a
        // click cannot reach), and only to this host; anything else is clicked.
        switched = await page.$eval(recipe.otpSwitch, (e) => (typeof e.href === "string" ? e.href : null))
          .then(async (href) => {
            if (href === null) return page.click(recipe.otpSwitch, { timeout: 5_000 }).then(() => true);
            if (!onSite(href, host)) return false;
            await page.goto(href);
            return true;
          })
          .catch(() => false);
      }
      if (await otpVisible(switched ? 15_000 : 3_000)) {
        if (!cred.totp) throw new Error("the site asks for a one-time code but the Bitwarden item has no authenticator key");
        if (!onSite(page.url(), host)) throw new Error("one-time code page is not on the expected host");
        // Some code pages submit on the last digit (GitHub). The field stays on screen until
        // the next page arrives, so its going away is too late a sign: a navigation request is
        // the early one. Pressing Enter into that navigation waited 3 s (measured). Not
        // pressing it is harmless, since only the success signal below counts as logged in.
        // ponytail: a page that submits itself more than 1 s after the last digit gets an Enter
        // too, a second submit of the same code; widen the window if a site needs it.
        const isNavigation = (r) => r.isNavigationRequest() && r.frame() === page.mainFrame();
        let navigated = false;
        const seeNavigation = (r) => { if (isNavigation(r)) navigated = true; };
        page.on("request", seeNavigation);
        try {
          const code = totpCode(cred.totp);
          typed.push(code);
          await onlyOnHost(page, host, async () => {
            await page.fill(otpField, code);
            const submittedItself = navigated || await Promise.race([
              page.waitForRequest(isNavigation, { timeout: 1_000 }).then(() => true, () => false),
              page.waitForSelector(otpField, { state: "hidden", timeout: 1_000 }).then(() => true, () => false),
            ]);
            if (!submittedItself) await page.press(otpField, "Enter", { timeout: 3_000 }).catch(() => {});
          });
        } finally {
          page.off("request", seeNavigation);
        }
        await page.waitForSelector(otpField, { state: "hidden", timeout: 30_000 }).catch(() => {});
      }
    } finally {
      cred = null;
    }

    // Success needs the recipe's own signal: any other page (an error, a landing page, a
    // still-pending challenge) fails closed. The landed path (no query) is named so a new
    // recipe can be filled in; it carries no credential.
    // Single-page apps route client-side after login (one landed on "/" first — measured):
    // give the router time to reach the success path, else let the page settle so the
    // reported landing is the final one.
    await (recipe.successSelector
      ? page.waitForSelector(recipe.successSelector, { state: "visible", timeout: 15_000 })
      : page.waitForURL((u) => u.host === host && underPath(u.pathname, recipe.successPath), { timeout: 15_000 }))
      .catch(() => page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {}));
    const landed = new URL(page.url());
    if (!(await showsLoggedIn(page, host, recipe))) {
      const links = await describeLinks(page);
      throw new Error(`the site did not confirm the login (landed on ${landed.host}${landed.pathname}; inputs: ${await describeInputs(page)}${links ? `; links: ${links}` : ""})`);
    }
    await page.close();
    const old = browserSessions.get(host);
    browserSessions.set(host, context);
    await old?.close().catch(() => {});
  } catch (e) {
    const name = !e.botCheck && page && await botCheck(page);
    await context.close();
    if (name) throw botStop(name);
    const message = String(e?.message ?? e);
    if (typed.some((v) => v && [v, encodeURIComponent(v), encodeURI(v)].some((f) => message.includes(f)))) {
      throw new Error("the login failed, and its error contained the credential, so it is withheld; check the recipe's selectors and the site's login page");
    }
    throw e;
  }
}

export async function closeBrowser() {
  const browsers = [chromiumBrowser, viewer];
  chromiumBrowser = viewer = undefined;
  await Promise.all(browsers.map((b) => b?.close().catch(() => {})));
}

const RECIPES_FILE = process.env.AGENT_LOGIN_BROKER_RECIPES || `${CONFIG_DIR}/recipes.json`;

// Read again on every login so a recipe saved after a proposal works without restarting
// the MCP client.
function reloadRecipes() {
  const fresh = loadRecipes(RECIPES_FILE);
  for (const host of Object.keys(RECIPES)) delete RECIPES[host];
  Object.assign(RECIPES, fresh);
}

async function login(host) {
  reloadRecipes();
  const recipe = RECIPES[host];
  if (!recipe) throw new Error(`no recipe for ${host} in ${RECIPES_FILE}; call propose_recipe to draft one`);
  await loginWithBrowser(host, recipe).catch((e) => handOverBotCheck(e, host, `https://${host}${recipe.loginPath}`));
}

// A bot check needs the human: show them the login page and tell the agent to keep off it.
async function handOverBotCheck(e, host, url) {
  if (!e.botCheck) throw e;
  const shown = await showPage(host, url, [], [], { session: false })
    .then((s) => `${s} for the user to log in there themselves`, (err) => `could not show the login page (${err.message})`);
  throw new Error(`${host} stops automated logins with a bot check (${e.botCheck}), so no recipe can log in; ${shown}. ` +
    `Tell the user so. Do not read or drive that page while they log in, and do not call login or propose_recipe for ${host} again unless they ask.`);
}

// Runs in the page: the visible password field and the account field of the same form, each
// as a selector that matches exactly one element, plus every URL that form can submit to.
// Ranked by the standard autocomplete tokens first; a name guess only breaks ties among the
// inputs before the password field.
function pickLoginFields() {
  const visible = (e) => e.getClientRects().length > 0;
  const unique = (e) => [
    e.name && `input[name="${CSS.escape(e.name)}"]`,
    e.id && `#${CSS.escape(e.id)}`,
    e.autocomplete && `input[autocomplete="${CSS.escape(e.autocomplete)}"]`,
  ].find((s) => s && document.querySelectorAll(s).length === 1) ?? null;
  const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
  if (passwords.length !== 1) return { error: passwords.length ? "several password fields (a sign-up or change-password form?)" : "no visible password field" };
  const pw = passwords[0];
  // Same form owner as the password field, or likewise formless: script-driven logins often
  // have no <form> at all, so refusing those would refuse most of them, and a formless field
  // has no native submission to send anywhere.
  const before = [...document.querySelectorAll("input")]
    .filter((e) => e.form === pw.form && visible(e) && ["text", "email", "tel"].includes(e.type)
      && (e.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING));
  const rank = (e) => /\busername\b/.test(e.autocomplete) ? 0 : e.type === "email" || /\bemail\b/.test(e.autocomplete) ? 1
    : /user|mail|login|account|id/i.test(`${e.name} ${e.id}`) ? 2 : 3;
  const user = before.sort((a, b) => rank(a) - rank(b))[0];
  if (!user) return { error: "no account field before the password field (a two-step login?)" };
  const targets = pw.form ? [pw.form.action, ...[...document.querySelectorAll("[formaction]")].filter((b) => b.form === pw.form).map((b) => b.formAction)] : [];
  return { username: unique(user), password: unique(pw), targets };
}

// Opens the login page without any credential and drafts a recipe from it. Nothing is
// saved: a recipe decides which field receives the password, so a human looks at it first.
export async function proposeRecipe(host, path = "/", { prepare } = {}) {
  const start = new URL(path, `https://${host}/`);
  if (!onSite(start.href, host)) throw new Error(`path must be on https://${host}`);
  const { chromium } = await import("playwright");
  chromiumBrowser ??= await chromium.launch({ headless: true });
  const context = await chromiumBrowser.newContext();
  try {
    await prepare?.(context);
    const page = await context.newPage();
    // A redirect must not take this browser to another host, an internal one included.
    await onlyOnHost(page, host, async () => {
      await page.goto(start.href);
      await page.waitForSelector(`input[type="password"], ${BOT_CHECK_ANY}`, { state: "visible", timeout: 15_000 }).catch(() => {});
    });
    const at = new URL(page.url());
    if (!onSite(at.href, host)) throw new Error(`the login page is on another host (${at.host}); not supported`);
    // A recipe would never get past it.
    const bot = await botCheck(page);
    if (bot) throw botStop(bot);
    const found = await page.evaluate(pickLoginFields);
    if (found.error) throw new Error(`${found.error} on ${at.pathname} (inputs: ${await describeInputs(page)}); pass the login page's path`);
    if (!found.username || !found.password) throw new Error(`the fields on ${at.pathname} have no unique name, id or autocomplete (inputs: ${await describeInputs(page)})`);
    // Pressing Enter submits the form natively when no script stops it, so a form that posts
    // elsewhere would send the password there.
    const away = found.targets.find((t) => !onSite(t, host));
    if (away) throw new Error(`the login form on ${at.pathname} submits to ${new URL(away).origin}; not supported`);
    return { [host]: { loginPath: at.pathname, username: found.username, password: found.password, successPath: null } };
  } finally {
    await context.close();
  }
}

// Where open_page may go on a logged-in host: the area under its recipe's successPath.
// Anything that resolves elsewhere is refused.
export function pageUrl(host, path, recipe = RECIPES[host]) {
  const base = recipe.successPath;
  const u = new URL(path ?? `${base.replace(/\/+$/, "")}/`, `https://${host}/`);
  if (!onSite(u.href, host) || !underPath(u.pathname, base)) {
    throw new Error(`path must be a ${base} page on the site`);
  }
  return u.href;
}

const TERMINAL_BROWSER = process.env.AGENT_LOGIN_BROKER_TERMINAL_BROWSER || "terminal-browser";
let terminalBrowser;
const hasTerminalBrowser = () => terminalBrowser ??= new Promise((resolve) =>
  execFile(TERMINAL_BROWSER, ["--version"], { timeout: 15_000 }, (err) => resolve(err?.code !== "ENOENT")));

// Only cookies the host itself would be sent (its own or a parent domain's): a login can
// collect cookies of other sites (SSO, analytics) that the viewer has no business holding.
export const cookiesFor = (cookies, host) =>
  cookies.filter((c) => { const d = c.domain.replace(/^\./, ""); return host === d || host.endsWith(`.${d}`); });

// Show the logged-in site to the human: in a terminal-browser pane inside herdr when
// terminal-browser is installed, else in a Chromium window of this process. Either browser
// only ever receives session state (the host's cookies and localStorage), never the password.
async function openPage(host, path) {
  const ctx = browserSessions.get(host);
  if (!ctx) throw new Error(`not logged in to ${host}; call login first`);
  const url = pageUrl(host, path);
  const { cookies, origins = [] } = await ctx.storageState();
  const storage = origins.find((o) => o.origin === `https://${host}`)?.localStorage ?? [];
  return showPage(host, url, cookiesFor(cookies, host), storage);
}

const showPage = async (host, url, cookies, storage, opts) => (await hasTerminalBrowser())
  ? openInTerminalBrowser(host, url, cookies, storage, opts)
  : openInChromium(host, url, cookies, storage, opts);

// Main-frame documents are paused over CDP until `fn` settles: requests before they are
// sent, responses before their Location is followed, and anything off the host fails.
// Playwright's routing never sees redirects (measured), so it cannot do this. Lifted
// afterwards, so a human can browse on.
async function onlyOnHost(page, host, fn) {
  const cdp = await page.context().newCDPSession(page);
  const { frameTree } = await cdp.send("Page.getFrameTree");
  let left;
  cdp.on("Fetch.requestPaused", (e) => {
    const location = e.responseHeaders?.find((h) => h.name.toLowerCase() === "location")?.value;
    const to = e.responseStatusCode === undefined ? e.request.url : location && new URL(location, e.request.url).href;
    const off = e.frameId === frameTree.frame.id && to && !onSite(to, host);
    if (off) left = new URL(to).host;
    cdp.send(off ? "Fetch.failRequest" : "Fetch.continueRequest",
      off ? { requestId: e.requestId, errorReason: "BlockedByClient" } : { requestId: e.requestId }).catch(() => {});
  });
  await cdp.send("Fetch.enable", { patterns: ["Request", "Response"].map((requestStage) => ({ urlPattern: "*", resourceType: "Document", requestStage })) });
  try {
    return await fn();
  } catch (e) {
    throw left ? new Error(`the site sent the browser off ${host} (to ${left}); stopped before it left`) : e;
  } finally {
    await cdp.send("Fetch.disable").catch(() => {});
    await cdp.detach().catch(() => {});
  }
}

// The page holds the session already, so a redirect to another host would carry the
// parent-domain cookies there before any URL check could run.
// `session: false` shows a page with no session to check (the login page itself).
async function landOn(page, host, url, storage = [], { session = true } = {}) {
  return onlyOnHost(page, host, async () => {
    if (storage.length) {
      // localStorage can only be written from the origin itself: stop on any page of the
      // host first, write, then go to the target so the app boots logged in.
      await page.goto(`https://${host}/robots.txt`);
      if (!onSite(page.url(), host)) throw new Error("could not reach the site to hand over the session");
      await page.evaluate((items) => { for (const { name, value } of items) localStorage.setItem(name, value); }, storage);
    }
    await page.goto(url);
    if (!session) return page.url();
    const recipe = RECIPES[host];
    await (recipe.successSelector
      ? page.waitForSelector(recipe.successSelector, { state: "visible", timeout: 15_000 })
      : page.waitForURL((u) => u.host === host && underPath(u.pathname, recipe.successPath), { timeout: 15_000 })).catch(() => {});
    if (!(await showsLoggedIn(page, host, recipe))) {
      throw new Error("session expired; call login again");
    }
    return page.url();
  });
}

// The session handed to terminal-browser is as reachable to the agent as anything in it
// (`terminal-browser action`), and terminal-browser keeps one store for all its windows —
// accepted: the session is what the human chose to share with the agent by opening it here.
async function openInTerminalBrowser(host, url, cookies, storage, opts) {
  const { key, cdpPort, target } = await brokerWindow();

  const { chromium } = await import("playwright");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  try {
    let page;
    // The new tab shows up as a CDP target a moment after `open` returns (measured).
    for (let i = 0; i < 20 && !page; i++) {
      for (const c of browser.contexts()) for (const p of c.pages()) {
        const s = await c.newCDPSession(p);
        const { targetInfo } = await s.send("Target.getTargetInfo");
        await s.detach();
        if (targetInfo.targetId === target) page = p;
      }
      if (!page) await new Promise((r) => setTimeout(r, 250));
    }
    if (!page) throw new Error("could not attach to the new terminal-browser tab");
    await page.context().addCookies(cookies);
    return `opened ${await landOn(page, host, url, storage, opts)} in terminal-browser (${key})`;
  } finally {
    await browser.close(); // disconnects; the window stays open for the human
  }
}

// Like the login Chromium, this window is driven over a pipe: the agent has no handle on
// it. One window at a time; closed with the server.
let viewer;

async function openInChromium(host, url, cookies, storage, opts) {
  const { chromium } = await import("playwright");
  if (!viewer?.isConnected()) viewer = await chromium.launch({ headless: false });
  const previous = viewer.contexts();
  const context = await viewer.newContext({ viewport: null });
  let at;
  try {
    await context.addCookies(cookies);
    at = await landOn(await context.newPage(), host, url, storage, opts);
  } catch (e) {
    await context.close();
    throw e;
  }
  await Promise.all(previous.map((c) => c.close().catch(() => {})));
  return `opened ${at} in a Chromium window`;
}

// One browser window for the broker, shared by the stdio and HTTP instances: each call
// navigates it instead of splitting yet another pane. The window's key is remembered in a
// file; if the human closed it, a new one replaces it.
const WINDOW_FILE = `${process.env.HOME}/.cache/agent-login-broker/window`;

const listBrowsers = async () =>
  JSON.parse((await run(TERMINAL_BROWSER, ["ls", "--all", "--json"])) || "{}").browsers ?? [];

function windowOf(b) {
  const tab = b.tabs.find((t) => t.active) ?? b.tabs[0];
  return { key: b.key, cdpPort: b.cdpPort, target: tab.targetId };
}

async function brokerWindow() {
  let known;
  try { known = readFileSync(WINDOW_FILE, "utf8").trim(); } catch {}
  const live = (await listBrowsers()).find((b) => b.key === known && b.tabs?.length);
  if (live) return windowOf(live);

  // Split next to the caller's herdr pane (a stdio broker started by an agent inside herdr); the detached HTTP
  // broker has none, so open beside aac listen instead.
  const env = { ...process.env };
  if (!env.HERDR_PANE_ID) {
    const a = await approverWorkspace();
    if (!a?.pane) throw new Error("no herdr pane to open the browser in");
    Object.assign(env, { HERDR_ENV: "1", HERDR_PANE_ID: a.pane });
  }
  // --no-merge: its own window, not a tab in some neighbour browser the human is using.
  // `open` prints "opened <key> …" (v0.15); details come from `ls`.
  const out = await run(TERMINAL_BROWSER, ["open", "about:blank", "--split", "right", "--no-merge"], env);
  const key = /opened (\S+)/.exec(out ?? "")?.[1];
  if (!key) throw new Error("terminal-browser did not open");
  let b;
  for (let i = 0; i < 20 && !b; i++) {
    b = (await listBrowsers()).find((x) => x.key === key && x.tabs?.length);
    if (!b) await new Promise((r) => setTimeout(r, 250));
  }
  if (!b) throw new Error("terminal-browser window did not appear");
  mkdirSync(dirname(WINDOW_FILE), { recursive: true });
  writeFileSync(WINDOW_FILE, `${key}\n`);
  return windowOf(b);
}

async function buildServer(allowed) {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { z } = await import("zod");
  const sites = allowed ? [...allowed].join(", ") || "(none configured)"
    : `any site with a recipe in ${RECIPES_FILE} (now: ${Object.keys(RECIPES).join(", ") || "none"})`;
  const tb = await hasTerminalBrowser();
  // Agents otherwise reach for a general browser tool and type the password themselves
  // (Codex did exactly that — measured); the instructions tell them this server owns logins.
  const server = new McpServer({ name: "agent-login-broker", version: VERSION }, {
    instructions: `Use this server — not a browser tool, agent-browser, or Playwright — whenever the user asks to log in to, or open the logged-in pages of, ${allowed ? sites : "a website"}. ` +
      `Before calling login(site), tell the user an approval request may appear in \`aac listen\` (for a site with a recipe, login blocks until they approve, up to 3 minutes; you never see the password). Then call login(site), and after it succeeds, open_page(site, path?) to show the logged-in page to the user ${tb ? "in a herdr pane" : "in a browser window"}. ` +
      "If login reports no recipe, call propose_recipe(site) and follow its instructions. " +
      "Never ask the user for these passwords and never type credentials for these sites into any browser yourself.",
  });
  const text = (t) => ({ content: [{ type: "text", text: t }] });
  const guard = (fn) => async (args) => {
    try { return text(await fn(args)); } catch (e) { return { ...text(e.message), isError: true }; }
  };

  server.tool("login",
    `Log in to ${allowed ? `an allow-listed site (${sites})` : sites}. Use this instead of a browser for these sites. A human must approve the credential request in \`aac listen\`. The credential is never returned.`,
    { site: z.string().describe(allowed ? `host, one of: ${sites}` : "host, e.g. app.example.com") },
    guard(async ({ site }) => { const h = checkSite(site, allowed); await login(h); return `logged in to ${h}`; }));

  server.tool("open_page",
    `Show the logged-in site to the human ${tb ? "in a terminal-browser pane in herdr" : "in a Chromium window"}: a page under the site's success path (default: the success path itself). ` +
      (tb ? "The agent can then also drive that page through terminal-browser." : "The agent has no handle on that window."),
    { site: z.string(), path: z.string().optional() },
    guard(async ({ site, path }) => openPage(checkSite(site, allowed), path)));

  server.tool("propose_recipe",
    `Draft the recipe login needs for ${allowed ? `an allow-listed site (${sites})` : "a site"} by inspecting its login page without any credential. Nothing is saved.`,
    { site: z.string(), path: z.string().optional().describe("path of the login page if / does not show it, e.g. /login") },
    guard(async ({ site, path }) => {
      const host = checkSite(site, allowed);
      if (!allowed && isInternalHost(host)) throw new Error(`${host} is an internal address; list it in AGENT_LOGIN_BROKER_SITES to draft a recipe for it`);
      const draft = await proposeRecipe(host, path).catch((e) => handOverBotCheck(e, host, new URL(path ?? "/", `https://${host}/`).href));
      return `${JSON.stringify(draft, null, 2)}\n\n` +
        `1. Show this recipe to the user and get their approval before saving it: it decides which field receives the password.\n` +
        `2. successPath is unknown until a login: ask the user which path the site shows right after logging in, or save "/unknown" for now; ` +
        `login then fails with the path it landed on, which becomes successPath.\n` +
        `3. Merge it into ${RECIPES_FILE} (a JSON object of host -> recipe), then call login. No restart is needed.`;
    }));
  return server;
}

export const TOKEN_HEADER = "x-agent-login-broker-token";

// The caller token keeps other local processes and containers (which can reach the host's
// loopback through host.docker.internal, e.g. under OrbStack) from driving
// the tools. It is not a secret from the agent that is meant to use them; the credential
// gate stays the human approval in `aac listen`.
export function tokenMatches(given, token) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

// An empty or hand-edited token file must not turn into "any header passes".
export function loadToken(path) {
  let token;
  try {
    token = readFileSync(path, "utf8").trim();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    token = randomBytes(32).toString("hex");
    writeFileSync(path, `${token}\n`, { mode: 0o600, flag: "wx" });
  }
  if (!TOKEN_SHAPE.test(token)) throw new Error(`token file is malformed: ${path} (delete it to regenerate)`);
  return token;
}

// Stateless Streamable HTTP: a fresh MCP server per request. Login sessions live in the
// module-level `browserSessions` map, so they survive across requests and callers.
async function serveHttp(port, allowed) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const token = loadToken(process.env.AGENT_LOGIN_BROKER_TOKEN_FILE || `${CONFIG_DIR}/token`);
  const hosts = ["127.0.0.1", "localhost", "host.docker.internal"].map((h) => `${h}:${port}`);
  const httpServer = createServer(async (req, res) => {
    if (!tokenMatches(req.headers[TOKEN_HEADER], token)) {
      res.writeHead(401).end();
      return;
    }
    const server = await buildServer(allowed);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableDnsRebindingProtection: true, allowedHosts: hosts,
    });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  // Loopback only: OrbStack forwards host.docker.internal to the Mac's loopback.
  await new Promise((r) => httpServer.listen(port, "127.0.0.1", r));
  return httpServer;
}

async function main() {
  reloadRecipes();
  const allowed = allowedSites();
  const port = process.argv[2] === "--http" ? Number(process.argv[3]) : 0;
  let httpServer;
  if (port) {
    httpServer = await serveHttp(port, allowed);
  } else {
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    await (await buildServer(allowed)).connect(new StdioServerTransport());
    process.stdin.on("close", () => shutdown());
  }
  const shutdown = async () => {
    httpServer?.close();
    await closeBrowser();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// realpath: started through npm's bin symlink, argv[1] is the link, not this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
