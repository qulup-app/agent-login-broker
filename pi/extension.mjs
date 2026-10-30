import { fileURLToPath } from "node:url";

// pi installs this package together with its dependencies, so the server runs from the
// installed copy instead of through npx. Three small tools: declared to the model directly
// rather than behind codemode, so a login request finds them without a search.
export default function (pi) {
  pi.registerMcpServer("agent-login-broker", {
    command: "node",
    args: [fileURLToPath(new URL("../server.mjs", import.meta.url))],
    exposure: "direct",
  });
}
