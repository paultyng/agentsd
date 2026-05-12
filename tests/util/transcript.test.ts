import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractModel } from "../../src/util/transcript";

let workDir: string | null = null;

async function writeJsonl(lines: unknown[]): Promise<string> {
  workDir = await mkdtemp(join(tmpdir(), "transcript-"));
  const path = join(workDir, "transcript.jsonl");
  await writeFile(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
    workDir = null;
  }
});

describe("extractModel", () => {
  it("returns the model from the most recent assistant message", async () => {
    const path = await writeJsonl([
      { type: "user", message: { role: "user", content: "hi" } },
      { type: "assistant", message: { role: "assistant", model: "claude-sonnet-4-6", content: "hi back" } },
      { type: "user", message: { role: "user", content: "follow up" } },
      { type: "assistant", message: { role: "assistant", model: "claude-opus-4-7", content: "ok" } },
    ]);
    expect(await extractModel(path)).toBe("claude-opus-4-7");
  });

  it("returns null when the file does not exist", async () => {
    expect(await extractModel("/nonexistent/path/transcript.jsonl")).toBeNull();
  });

  it("skips malformed lines and returns the first valid assistant model from the end", async () => {
    workDir = await mkdtemp(join(tmpdir(), "transcript-"));
    const path = join(workDir, "transcript.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-4-6" } }),
        "this is not json",
        JSON.stringify({ type: "user", message: { content: "hi" } }),
        "{broken",
      ].join("\n"),
    );
    expect(await extractModel(path)).toBe("claude-sonnet-4-6");
  });

  it("returns null when there are no assistant messages", async () => {
    const path = await writeJsonl([
      { type: "user", message: { content: "hi" } },
      { type: "user", message: { content: "anyone there?" } },
    ]);
    expect(await extractModel(path)).toBeNull();
  });

  it("returns null when assistant messages lack a model field", async () => {
    const path = await writeJsonl([
      { type: "assistant", message: { role: "assistant", content: "no model here" } },
    ]);
    expect(await extractModel(path)).toBeNull();
  });
});
