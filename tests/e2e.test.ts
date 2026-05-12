import { afterEach, describe, expect, it } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HookServer } from "../src/hook-server";
import { SessionManager } from "../src/session-manager";
import type { HookEventName } from "../src/types";

// Resolve testagent. CI installs it via `gh release download`; locally devs
// usually have it via `go install github.com/paultyng/testagent/cmd/testagent@latest`.
// If absent, skip these tests rather than fail the suite.
let testagentPath: string | null = null;
try {
  testagentPath = execSync("command -v testagent", { encoding: "utf8" }).trim() || null;
} catch {
  /* not on PATH */
}

const runE2E = testagentPath ? describe : describe.skip;

const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "StopFailure",
  "PermissionRequest",
  "Notification",
];

interface Harness {
  manager: SessionManager;
  server: HookServer;
  port: number;
  workDir: string;
  settingsPath: string;
  child: ChildProcess | null;
  /** Hook events observed by the SessionManager, in order. */
  events: Array<{ event: HookEventName; sessionId: string }>;
  /** Resolves when the spawned testagent process exits. */
  exitPromise: Promise<number | null>;
}

let harness: Harness | null = null;

async function startHarness(): Promise<Harness> {
  const manager = new SessionManager();
  manager.start();
  const server = new HookServer(manager, 0, { debugEnabled: true, permissionTimeoutMs: 5_000 });
  await server.start();
  const port = server.listeningPort!;
  const workDir = await mkdtemp(join(tmpdir(), "agentsd-e2e-"));

  const settings = {
    hooks: Object.fromEntries(
      HOOK_EVENTS.map((e) => [
        e,
        [{ matcher: "", hooks: [{ type: "http", url: `http://127.0.0.1:${port}/hooks/${e}`, timeout: 5 }] }],
      ]),
    ),
  };
  const settingsPath = join(workDir, "settings.json");
  await writeFile(settingsPath, JSON.stringify(settings));

  const events: Array<{ event: HookEventName; sessionId: string }> = [];
  manager.on("sessionUpdated", (session, event) => {
    events.push({ event, sessionId: session.id });
  });

  // exitPromise is assigned after spawn().
  return { manager, server, port, workDir, settingsPath, child: null, events, exitPromise: Promise.resolve(null) };
}

function attachExitTracker(h: Harness): void {
  h.exitPromise = new Promise<number | null>((resolve) => {
    h.child!.on("exit", (code) => resolve(code));
  });
}

async function waitForEvent(h: Harness, event: HookEventName, sessionId: string, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (h.events.some((e) => e.event === event && e.sessionId === sessionId)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`${event} for ${sessionId} not observed in ${timeoutMs}ms; saw: ${JSON.stringify(h.events)}`);
}

afterEach(async () => {
  if (harness?.child && harness.child.exitCode === null && !harness.child.killed) {
    harness.child.kill("SIGKILL");
  }
  if (harness) {
    await harness.server.stop();
    harness.manager.stop();
    await rm(harness.workDir, { recursive: true, force: true });
  }
  harness = null;
});

runE2E("E2E via testagent", () => {
  // E2E's job: prove testagent's hook payload shape matches what the server
  // expects. Per-event behavior is already covered by tests/hook-server.test.ts
  // POSTing hook payloads directly. The E2E layer just proves the wire-up
  // (testagent → http → hook-server → SessionManager) is intact.
  it("fires SessionStart and SessionEnd around a one-shot --print session", async () => {
    harness = await startHarness();
    const sessionId = "e2e-lifecycle-1";

    harness.child = spawn(
      testagentPath!,
      [
        "claude",
        "--settings", harness.settingsPath,
        "--session-id", sessionId,
        "--print", "hello",
        "--stream-delay", "0",
        "--think-delay", "0",
      ],
      { env: { ...process.env, HOME: harness.workDir }, stdio: ["ignore", "pipe", "pipe"] },
    );
    attachExitTracker(harness);

    await waitForEvent(harness, "SessionStart", sessionId);
    const exit = await harness.exitPromise;
    expect(exit).toBe(0);
    await waitForEvent(harness, "SessionEnd", sessionId);
    expect(harness.manager.sessionCount).toBe(0);
  });

  it("fires PostToolUse when testagent runs /fake-tool + /fake-tool-result", async () => {
    harness = await startHarness();
    const sessionId = "e2e-tool-1";

    harness.child = spawn(
      testagentPath!,
      [
        "claude",
        "--settings", harness.settingsPath,
        "--session-id", sessionId,
        "--stream-delay", "0",
        "--think-delay", "0",
      ],
      { env: { ...process.env, HOME: harness.workDir }, stdio: ["pipe", "pipe", "pipe"] },
    );
    attachExitTracker(harness);

    await waitForEvent(harness, "SessionStart", sessionId);

    // /fake-tool prints a fake tool-use block; /fake-tool-result fires PostToolUse.
    // (testagent does NOT fire PreToolUse from these commands by design.)
    harness.child.stdin!.write('/fake-tool Bash {"command":"echo hi"}\n');
    harness.child.stdin!.write('/fake-tool-result {"stdout":"hi"}\n');

    await waitForEvent(harness, "PostToolUse", sessionId);

    harness.child.stdin!.write("/exit 0\n");
    harness.child.stdin!.end();
    await harness.exitPromise;
    await waitForEvent(harness, "SessionEnd", sessionId);
  });
});
