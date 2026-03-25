import { readFile } from "node:fs/promises";

/**
 * Extract the model identifier from a Claude Code transcript JSONL file.
 * Scans from the end to find the most recent assistant message with a model field.
 */
export async function extractModel(transcriptPath: string): Promise<string | null> {
  // TODO: for large transcripts, use a reverse/streaming reader instead of loading the whole file
  let data: string;
  try {
    data = await readFile(transcriptPath, "utf-8");
  } catch {
    return null;
  }

  const lines = data.trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const record = JSON.parse(lines[i]);
      if (record.type === "assistant" && record.message?.model) {
        return record.message.model;
      }
    } catch {
      // skip malformed lines
    }
  }
  return null;
}
