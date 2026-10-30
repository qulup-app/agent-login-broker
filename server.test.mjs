import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aacReason, allowedSites, callerPane, checkSite, cookiesFor, isInternalHost, loadRecipes, loadToken, onSite, pageUrl, parseCredential, tokenMatches, totpCode } from "./server.mjs";

const SECRET = "hunter2-SECRET";

test("parseCredential returns the pair and never echoes stdout in errors", () => {
  const ok = JSON.stringify({ success: true, credential: { username: "u", password: SECRET } });
  assert.deepEqual(parseCredential(ok), { username: "u", password: SECRET, totp: null });

  const bad = [
    `not json ${SECRET}`,
    JSON.stringify({ success: false, error: SECRET }),
    JSON.stringify({ success: true, credential: { username: "u", password: "" }, note: SECRET }),
  ];
  for (const out of bad) {
    assert.throws(() => parseCredential(out), (e) => !e.message.includes(SECRET));
  }
});

test("checkSite refuses Google sign-in and points to other ways", () => {
  for (const g of ["accounts.google.com", "google.com", "www.google.co.jp", "mail.google.com", "google.com:444", "www.google.co.jp:8443"]) {
    assert.throws(() => checkSite(g, null), /Google rejects sign-in from automated browsers/, g);
    assert.throws(() => checkSite(g, allowedSites(g)), /Google rejects/, g);
  }
  for (const ok of ["googleusercontent.example", "notgoogle.com", "google.com.evil.example"]) {
    assert.equal(checkSite(ok, null), ok);
  }
});

test("checkSite takes bare hosts, narrowed only by AGENT_LOGIN_BROKER_SITES", () => {
  const allowed = allowedSites(" cms.example.jp , other.example.jp ");
  assert.equal(checkSite("CMS.example.jp", allowed), "cms.example.jp");
  assert.throws(() => checkSite("evil.example", allowed));
  assert.throws(() => checkSite("cms.example.jp.evil.example", allowed));
  assert.deepEqual(allowedSites(" , "), new Set());
  assert.throws(() => checkSite("app.example.com", allowedSites("")), /site not allowed/);
  assert.equal(allowedSites(undefined), null);
  assert.equal(checkSite("app.example.com", null), "app.example.com");
  for (const bad of ["", "app.example.com/login", "user@app.example.com", "https://app.example.com", "a b.example"]) {
    assert.throws(() => checkSite(bad, null), /not a host name/, bad);
  }
});

test("isInternalHost refuses names and addresses that only reach inside a network", () => {
  for (const h of ["localhost", "localhost.", "router", "nas.local", "router.local.", "app.internal", "x.home.arpa", "10.0.0.1", "127.0.0.1:8443",
    "172.16.5.4", "172.31.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "[::1]"]) {
    assert.equal(isInternalHost(h), true, h);
  }
  for (const h of ["app.example.com", "github.com", "172.32.0.1", "8.8.8.8", "app.example.com:8443"]) {
    assert.equal(isInternalHost(h), false, h);
  }
});

test("onSite requires https on the exact host", () => {
  assert.equal(onSite("https://cms.example.jp/login", "cms.example.jp"), true);
  assert.equal(onSite("http://cms.example.jp/login", "cms.example.jp"), false);
  assert.equal(onSite("https://cms.example.jp.evil.example/", "cms.example.jp"), false);
  assert.equal(onSite("https://cms.example.jp:8443/", "cms.example.jp"), false);
  assert.equal(onSite("https://user@cms.example.jp/", "cms.example.jp"), false);
  assert.equal(onSite("https://user:pw@cms.example.jp/home/", "cms.example.jp"), false);
  assert.throws(() => pageUrl("cms.example.jp", "https://user:pw@cms.example.jp/home/", { successPath: "/home" }));
});

test("cookiesFor keeps only cookies the host itself would be sent", () => {
  const c = (domain) => ({ name: domain, domain });
  const kept = cookiesFor([c("app.example.com"), c(".example.com"), c("example.com"), c("sso.example.com"),
    c(".other.example"), c("evilapp.example.com"), c(".com.evil")], "app.example.com");
  assert.deepEqual(kept.map((k) => k.domain), ["app.example.com", ".example.com", "example.com"]);
});

test("tokenMatches accepts only the exact token", () => {
  const t = "a".repeat(64);
  assert.equal(tokenMatches(t, t), true);
  assert.equal(tokenMatches("a".repeat(63), t), false);
  assert.equal(tokenMatches("b".repeat(64), t), false);
  assert.equal(tokenMatches(undefined, t), false);
  assert.equal(tokenMatches(["a".repeat(64)], t), false); // duplicated header arrives as an array
  // same character count, different UTF-8 byte length: must reject, not throw
  assert.equal(tokenMatches("é".repeat(64), t), false);
});

test("loadToken rejects empty or malformed token files and creates a valid one", () => {
  const dir = mkdtempSync(join(tmpdir(), "lb-token-"));
  try {
    const empty = join(dir, "empty");
    writeFileSync(empty, "  \n");
    assert.throws(() => loadToken(empty));
    const short = join(dir, "short");
    writeFileSync(short, "abc\n");
    assert.throws(() => loadToken(short));
    const fresh = join(dir, "sub", "token");
    const t = loadToken(fresh);
    assert.match(t, /^[0-9a-f]{64}$/);
    assert.equal(statSync(fresh).mode & 0o777, 0o600);
    assert.equal(loadToken(fresh), t);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("an item named by itemId must share the recipe host's registrable domain", () => {
  const out = (uri) => JSON.stringify({ success: true, credential: { username: "u", password: "p", uri } });
  for (const [uri, host] of [
    ["https://www.google.com/accounts/ServiceLogin?service=mail&continue=https%3A%2F%2Fmail.google.com%2F", "accounts.google.com"],
    ["google.com", "accounts.google.com"],
    ["https://accounts.google.com", "accounts.google.com"],
    ["https://shop.example.co.jp/login", "www.example.co.jp"],
  ]) assert.equal(parseCredential(out(uri), host).username, "u", `${uri} for ${host}`);
  for (const [uri, host] of [
    ["https://evil.example", "accounts.google.com"],
    ["https://accounts.google.com.evil.example", "accounts.google.com"],
    ["https://a.co.jp", "b.co.jp"],
    ["https://alice.github.io", "bob.github.io"],
    ["https://127.0.0.1", "127.0.0.2"],
    [undefined, "accounts.google.com"],
  ]) assert.throws(() => parseCredential(out(uri), host), /not for/, `${uri} for ${host}`);
});

test("aacReason names why aac failed and never echoes a credential from stdout", () => {
  const SECRET = "hunter2-secret";
  assert.equal(aacReason("", "Credential request failed: Request denied\nat line 2"), ": Credential request failed: Request denied");
  assert.equal(aacReason(JSON.stringify({ success: false, error: "Request denied" }), ""), ": Request denied");
  assert.equal(aacReason(JSON.stringify({ success: false, error: { message: "no item" } }), ""), ": no item");
  assert.equal(aacReason("", ""), "");
  assert.equal(aacReason(JSON.stringify({ success: false, error: "x".repeat(500) }), "").length, ": ".length + 200);
  for (const stdout of [
    JSON.stringify({ success: true, credential: { username: "u", password: SECRET } }),
    JSON.stringify({ credential: { password: SECRET } }),
    JSON.stringify({ success: false, error: `denied ${SECRET}`, credential: { password: SECRET } }),
    `not json ${SECRET}`,
  ]) {
    assert.ok(!aacReason(stdout, "").includes(SECRET), stdout);
    assert.ok(!aacReason(stdout, "boom").includes(SECRET), stdout);
  }
});

test("loadRecipes: missing file is no recipes, a broken recipe stops startup", () => {
  const dir = mkdtempSync(join(tmpdir(), "lb-recipes-"));
  try {
    assert.deepEqual(loadRecipes(join(dir, "none.json")), {});
    const r = { loginPath: "/login", username: "#u", password: "#p", successPath: "/home" };
    const ok = join(dir, "ok.json");
    writeFileSync(ok, JSON.stringify({ " App.Example.com ": { ...r, otp: "#code" } }));
    assert.deepEqual(loadRecipes(ok), { "app.example.com": { ...r, otp: "#code" } });
    const root = join(dir, "root.json");
    writeFileSync(root, JSON.stringify({ "a.example": { ...r, successPath: "/", successSelector: "#me" } }));
    assert.equal(loadRecipes(root)["a.example"].successPath, "/");
    for (const [name, body] of [
      ["array", "[]"],
      ["no-success", JSON.stringify({ "a.example": { ...r, successPath: undefined } })],
      ["root-success", JSON.stringify({ "a.example": { ...r, successPath: "/" } })],
      ["blank-selector", JSON.stringify({ "a.example": { ...r, username: " " } })],
      ["relative-login", JSON.stringify({ "a.example": { ...r, loginPath: "login" } })],
      ["otp-number", JSON.stringify({ "a.example": { ...r, otp: 1 } })],
      ["blank-item-id", JSON.stringify({ "a.example": { ...r, itemId: " " } })],
      ["blank-otp-switch", JSON.stringify({ "a.example": { ...r, otpSwitch: "" } })],
      ["root-blank-selector", JSON.stringify({ "a.example": { ...r, successPath: "/", successSelector: " " } })],
      ["double-slash-success", JSON.stringify({ "a.example": { ...r, successPath: "//x", successSelector: "#me" } })],
      ["not-json", "{"],
    ]) {
      const f = join(dir, `${name}.json`);
      writeFileSync(f, body);
      assert.throws(() => loadRecipes(f), undefined, name);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("pageUrl opens the whole site when the success path is the root", () => {
  const r = { successPath: "/", successSelector: "#me" };
  assert.equal(pageUrl("app.example.com", undefined, r), "https://app.example.com/");
  assert.equal(pageUrl("app.example.com", "/org/repo", r), "https://app.example.com/org/repo");
  assert.throws(() => pageUrl("app.example.com", "https://evil.example/", r));
});

test("pageUrl keeps a site under its success path", () => {
  const h = "app.example.com";
  const r = { successPath: "/dashboard" };
  assert.equal(pageUrl(h, undefined, r), "https://app.example.com/dashboard/");
  assert.equal(pageUrl(h, "/dashboard/overview?tab=1", r), "https://app.example.com/dashboard/overview?tab=1");
  assert.equal(pageUrl(h, "https://app.example.com/dashboard/x", r), "https://app.example.com/dashboard/x");
  assert.equal(pageUrl(h, "/dashboard", r), "https://app.example.com/dashboard");
  for (const bad of ["/", "/account/login", "https://evil.example/dashboard/", "//evil.example/dashboard/", "http://app.example.com/dashboard/",
    "/dashboard-x", "/dashboard%2f..%2flogin", "/dashboard%5C..%5Cx", "/dashboard/../login"]) {
    assert.throws(() => pageUrl(h, bad, r), undefined, bad);
  }
});

test("totpCode matches RFC 6238 vectors, bare base32 and otpauth URIs", () => {
  // RFC 6238 Appendix B, SHA1 seed "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totpCode(seed, 59_000), "287082");
  assert.equal(totpCode(seed, 1111111109_000), "081804");
  assert.equal(totpCode(`otpauth://totp/x?secret=${seed}&digits=8`, 59_000), "94287082");
  assert.equal(totpCode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", 59_000), "287082");
  assert.throws(() => totpCode("not-base32!", 0));
});

test("every plugin manifest ships the package's own version and launches that exact npm release", () => {
  const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
  const { name, version } = json("./package.json");
  assert.equal(json("./plugin/plugin.json").version, version);
  assert.equal(json("./plugin/.claude-plugin/plugin.json").version, version);
  assert.equal(json("./.claude-plugin/marketplace.json").plugins.find((p) => p.name === name).version, version);
  assert.deepEqual(json("./plugin/mcp.json").mcpServers[name].args, ["-y", `${name}@${version}`]);
});

test("open_page uses terminal-browser only when the agent's herdr pane is known", async () => {
  const { spawn } = await import("node:child_process");
  // Any executable stands in for terminal-browser: only its presence is checked at startup.
  const describe = (extra) => new Promise((resolve, reject) => {
    const env = { ...process.env, AGENT_LOGIN_BROKER_TERMINAL_BROWSER: process.execPath, AGENT_LOGIN_BROKER_SITES: "a.example", ...extra };
    if (!("HERDR_PANE_ID" in extra)) delete env.HERDR_PANE_ID;
    const p = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { env, stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
      const m = out.split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((x) => x?.id === 2);
      if (m) { p.kill(); resolve(m.result.tools.find((t) => t.name === "open_page").description); }
    });
    p.on("error", reject);
    p.stdin.write([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ].map((m) => JSON.stringify(m)).join("\n") + "\n");
  });
  assert.match(await describe({ HERDR_PANE_ID: "w1:p1" }), /terminal-browser pane/);
  assert.match(await describe({}), /Chromium window/);
});

test("callerPane accepts herdr pane ids and nothing else", () => {
  assert.equal(callerPane("w1M:p2"), "w1M:p2");
  for (const bad of [undefined, "", "garbage", "not-a-pane", "w1M", "w1:t1", "w1:p1; rm -rf /", "../x", `w${"a".repeat(17)}:p1`, ["w1:p1"]]) assert.equal(callerPane(bad), undefined, String(bad));
});

test("the HTTP broker keeps terminal-browser whether or not the caller names its pane", async () => {
  const { spawn } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "lb-http-"));
  const tokenFile = join(dir, "token");
  const port = 47_000 + Math.floor(Math.random() * 1000);
  const p = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname, "--http", String(port)], {
    env: { ...process.env, AGENT_LOGIN_BROKER_TOKEN_FILE: tokenFile, AGENT_LOGIN_BROKER_TERMINAL_BROWSER: process.execPath, AGENT_LOGIN_BROKER_SITES: "a.example" },
    stdio: "ignore",
  });
  try {
    const describe = async (headers) => {
      for (let i = 0; i < 40; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-agent-login-broker-token": readFileSync(tokenFile, "utf8").trim(), ...headers },
            body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
          });
          return /open_page[^}]*?"description":"([^"]*)"/.exec(await res.text())?.[1] ?? "";
        } catch { await new Promise((r) => setTimeout(r, 250)); }
      }
      throw new Error("HTTP broker did not start");
    };
    assert.match(await describe({}), /terminal-browser pane/);
    assert.match(await describe({ "x-agent-login-broker-pane": "w9:p9" }), /terminal-browser pane/);
  } finally {
    p.kill();
    rmSync(dir, { recursive: true });
  }
});
