// BL-247 S1-10: `npm run e2e:mobile [playwright args]`. The phone projects sign
// in against the Firebase Auth emulator (port 9099). If one is already up (the
// compose stack's firebase-emulator service) attach to it; otherwise start one
// for the run with `firebase emulators:exec`, which re-invokes this script with
// --child (args travel in E2E_ARGS so no shell quoting is involved).
import net from "node:net";
import { spawn } from "node:child_process";
import { join } from "node:path";

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}

function runPlaywright(args) {
  const cli = join(process.cwd(), "node_modules", "@playwright", "test", "cli.js");
  const child = spawn(process.execPath, [cli, "test", ...args], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
}

const argv = process.argv.slice(2);

if (argv[0] === "--child") {
  runPlaywright(JSON.parse(process.env.E2E_ARGS ?? "[]"));
} else if (await portOpen(9099)) {
  console.log("[e2e:mobile] auth emulator attached on :9099");
  runPlaywright(argv);
} else {
  console.log("[e2e:mobile] auth emulator starting via emulators:exec");
  const child = spawn(
    'npx firebase-tools emulators:exec --only auth --project demo-swu "node e2e/run-mobile.mjs --child"',
    { stdio: "inherit", shell: true, env: { ...process.env, E2E_ARGS: JSON.stringify(argv) } }
  );
  child.on("exit", (code) => process.exit(code ?? 1));
}
