// Where brokerWindow splits terminal-browser, with fake terminal-browser and herdr binaries.
// Separate file because HOME and the binary paths must be set before server.mjs is loaded.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "lb-window-"));
const splits = join(dir, "splits");
const fake = (name, body) => { const p = join(dir, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };
// Each `open` hands out a new key; `ls` lists every key opened so far.
process.env.AGENT_LOGIN_BROKER_TERMINAL_BROWSER = fake("terminal-browser", `
case "$1" in
  open) n=$(($(wc -l < ${splits} 2>/dev/null || echo 0) + 1)); echo "$HERDR_PANE_ID" >> ${splits}; echo "opened k$n" ;;
  ls) printf '{"browsers":['; i=1; while [ $i -le $(wc -l < ${splits} 2>/dev/null || echo 0) ]; do [ $i -gt 1 ] && printf ,; printf '{"key":"k%s","cdpPort":1,"tabs":[{"active":true,"targetId":"t"}]}' $i; i=$((i+1)); done; echo ']}' ;;
esac`);
process.env.AGENT_LOGIN_BROKER_HERDR = fake("herdr", `
case "$1 $2" in
  "workspace list") echo '{"result":{"workspaces":[{"workspace_id":"wA","label":"aac-listen","focused":false}]}}' ;;
  "pane list") echo '{"result":{"panes":[{"pane_id":"wA:sidebar","label":"Sidebar"},{"pane_id":"wA:p1","label":null}]}}' ;;
esac`);
process.env.HOME = dir;
const { brokerWindow } = await import("./server.mjs");
after(() => rmSync(dir, { recursive: true }));

const lastSplit = () => readFileSync(splits, "utf8").trim().split("\n").at(-1);

test("a named pane gets its own window, split next to it, and reuses it", async () => {
  const first = await brokerWindow("w1:p1");
  assert.equal(lastSplit(), "w1:p1");
  assert.equal((await brokerWindow("w1:p1")).key, first.key);
  const other = await brokerWindow("w2:p3");
  assert.equal(lastSplit(), "w2:p3");
  assert.notEqual(other.key, first.key);
});

test("no pane (an HTTP caller without the header, or an invalid one) splits beside aac-listen", async () => {
  await brokerWindow(undefined);
  assert.equal(lastSplit(), "wA:p1");
});
