import { execFile } from "node:child_process";

function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

export async function focusGhostty(): Promise<void> {
  await runAppleScript(`
    tell application "Ghostty"
      activate
    end tell
  `);
}

export async function focusClaudeDesktop(): Promise<void> {
  await runAppleScript(`
    tell application "Claude"
      activate
    end tell
  `);
}

/**
 * Sends Ctrl+C to the frontmost Ghostty window.
 * This is a best-effort approach — we don't have PID access from hook payloads.
 */
export async function sendInterruptToGhostty(): Promise<void> {
  await focusGhostty();
  await runAppleScript(`
    tell application "System Events"
      tell process "Ghostty"
        keystroke "c" using control down
      end tell
    end tell
  `);
}
