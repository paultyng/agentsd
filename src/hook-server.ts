import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import streamDeck from "@elgato/streamdeck";
import type { SessionManager } from "./session-manager";
import type { HookEventName, HookPayload } from "./types";

const VALID_EVENTS = new Set<HookEventName>([
  "SessionStart", "SessionEnd",
  "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "Stop", "PermissionRequest", "Notification",
  "SubagentStart", "SubagentStop",
  "Elicitation", "ElicitationResult",
]);

/** How long to hold a PermissionRequest response open before auto-denying. */
const PERMISSION_TIMEOUT_MS = 120_000;
/** Maximum request body size (1 MB). */
const MAX_BODY_BYTES = 1_024 * 1_024;

export class HookServer {
  private server: Server | null = null;
  private readonly connections = new Set<Socket>();

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly port: number = 9200,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          streamDeck.logger.error(`Unhandled error in request handler: ${err}`);
          if (!res.writableEnded) {
            res.writeHead(500);
            res.end();
          }
        });
      });

      // Track connections for clean shutdown
      this.server.on("connection", (socket: Socket) => {
        this.connections.add(socket);
        socket.on("close", () => this.connections.delete(socket));
      });

      // Persistent error handler for post-startup errors
      this.server.on("error", (err) => {
        streamDeck.logger.error(`HTTP server error: ${err}`);
      });

      this.server.maxConnections = 100;

      this.server.listen(this.port, "127.0.0.1", () => resolve());
      this.server.once("error", reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      // Destroy open connections so server.close() doesn't hang
      for (const socket of this.connections) {
        socket.destroy();
      }
      this.connections.clear();
      this.server.close(() => resolve());
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    // Parse URL robustly (handles query strings and extra path segments)
    const url = new URL(req.url ?? "", "http://localhost");
    const segments = url.pathname.split("/");
    const eventName = segments[2];

    if (!eventName || !VALID_EVENTS.has(eventName as HookEventName)) {
      res.writeHead(404);
      res.end();
      return;
    }

    const validEvent = eventName as HookEventName;

    let payload: HookPayload;
    try {
      payload = await readJson(req);
    } catch (err) {
      const status = err instanceof PayloadTooLargeError ? 413 : 400;
      res.writeHead(status);
      res.end();
      return;
    }

    streamDeck.logger.debug(`Hook request: ${validEvent} session=${payload.session_id ?? "unknown"}`);

    // PermissionRequest: hold the response open
    if (validEvent === "PermissionRequest") {
      streamDeck.logger.info(`PermissionRequest: holding response for session=${payload.session_id} tool=${payload.tool_name ?? "unknown"}`);
      this.sessionManager.handleEvent(validEvent, payload);
      const timer = setTimeout(() => {
        streamDeck.logger.info(`PermissionRequest: timed out for session=${payload.session_id}`);
        // Send explicit deny on timeout instead of ambiguous {}
        if (!res.writableEnded) {
          const body = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "Timed out" } } };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
        }
        // Clear pending state without trying to write the response again
        this.sessionManager.clearPendingPermissionById(payload.session_id);
      }, PERMISSION_TIMEOUT_MS);

      this.sessionManager.setPendingPermission(payload.session_id, {
        req,
        res,
        toolName: payload.tool_name,
        timer,
      });
      this.resolveCallerPid(req, payload.session_id);
      return;
    }

    // All other events: process and respond immediately
    this.sessionManager.handleEvent(validEvent, payload);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");

    // Resolve PID from the remote port (fire-and-forget, don't block response)
    this.resolveCallerPid(req, payload.session_id);
  }

  /**
   * Resolve the PID of the Claude Code process from the incoming connection's remote port.
   * Runs asynchronously after the response is sent.
   */
  private resolveCallerPid(req: IncomingMessage, sessionId: string): void {
    const remotePort = req.socket.remotePort;
    if (!remotePort) return;

    execFile("lsof", ["-i", `TCP:${remotePort}`, "-t", "-sTCP:ESTABLISHED"], (err, stdout) => {
      if (err || !stdout.trim()) return;
      // lsof may return multiple PIDs; the first non-self PID is the caller
      const myPid = process.pid;
      for (const line of stdout.trim().split("\n")) {
        const pid = parseInt(line.trim(), 10);
        if (!isNaN(pid) && pid !== myPid) {
          this.sessionManager.setSessionPid(sessionId, pid);
          streamDeck.logger.debug(`Resolved PID ${pid} for session=${sessionId}`);
          return;
        }
      }
    });
  }
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
  }
}

function readJson(req: IncomingMessage): Promise<HookPayload> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
