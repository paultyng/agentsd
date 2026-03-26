import { EventEmitter } from "node:events";
import streamDeck from "@elgato/streamdeck";
import { transition } from "./state-machine";
import type { HookEventName, HookPayload, PendingPermission, SessionState } from "./types";
import { State } from "./types";
import { extractModel } from "./util/transcript";

/** Prune idle/disconnected sessions with no activity for 1 minute. */
const STALE_MS = 60 * 1000;
const STALE_PRUNE_STATES = new Set([State.IDLE, State.DISCONNECTED]);
const PRUNE_INTERVAL_MS = 60 * 1000;

export class SessionManager extends EventEmitter {
  private readonly sessions = new Map<string, SessionState>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private _activeIndex = 0;
  /** Session IDs with pending permissions, ordered by arrival. */
  private permissionQueue: string[] = [];

  constructor() {
    super();
    // 7 managed actions × 2 events + headroom
    this.setMaxListeners(20);
  }

  start(): void {
    this.pruneTimer = setInterval(() => this.pruneStale(), PRUNE_INTERVAL_MS);
  }

  stop(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    for (const session of this.sessions.values()) {
      this.clearPendingPermission(session);
    }
    this.sessions.clear();
  }

  get activeSession(): SessionState | undefined {
    const ids = [...this.sessions.keys()];
    if (ids.length === 0) return undefined;
    this._activeIndex = Math.min(this._activeIndex, ids.length - 1);
    return this.sessions.get(ids[this._activeIndex]);
  }

  get activeIndex(): number {
    return this._activeIndex;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  cycleSession(direction: number): SessionState | undefined {
    const count = this.sessions.size;
    if (count === 0) return undefined;
    this._activeIndex = ((this._activeIndex + direction) % count + count) % count;
    const session = this.activeSession;
    this.emit("activeSessionChanged", session);
    return session;
  }

  handleEvent(event: HookEventName, payload: HookPayload): SessionState | undefined {
    const id = payload.session_id;
    if (!id) return undefined;

    let session = this.sessions.get(id);

    if (!session) {
      // Auto-create session on any event (handles missed SessionStart or plugin restart).
      // Starts as IDLE (not DISCONNECTED) so subsequent tool events can transition normally.
      session = {
        id,
        state: State.IDLE,
        cwd: payload.cwd ?? "unknown",
        permissionMode: payload.permission_mode ?? "default",
        currentTool: null,
        activeSubagents: 0,
        lastError: null,
        model: payload.model ?? null,
        pendingPermission: null,
        pid: null,
        lastActivity: Date.now(),
      };
      this.sessions.set(id, session);

      // Backfill model from transcript if not in payload
      if (!session.model && payload.transcript_path) {
        extractModel(payload.transcript_path).then((model) => {
          const s = this.sessions.get(id);
          if (model && s && !s.model) {
            s.model = model;
            this.emit("sessionUpdated", s, event);
          }
        });
      }
    }

    session.lastActivity = Date.now();
    if (payload.model) session.model = payload.model;

    // Apply state transition
    const prevState = session.state;
    let nextState = transition(session.state, event);

    // Guard: suppress transitions away from AWAITING_PERMISSION when a plugin-held
    // permission is pending. Parallel tool events (PreToolUse, PostToolUse, etc.)
    // must not kick the session out of AWAITING_PERMISSION and auto-deny.
    if (
      session.pendingPermission &&
      prevState === State.AWAITING_PERMISSION &&
      nextState !== null &&
      nextState !== State.AWAITING_PERMISSION &&
      event !== "PermissionRequest" &&
      event !== "Stop" &&
      event !== "SessionEnd"
    ) {
      nextState = null;
    }

    if (nextState !== null) {
      session.state = nextState;
    }

    streamDeck.logger.info(`Event: ${event} session=${id} prev=${prevState} next=${session.state} hasPending=${!!session.pendingPermission} pid=${session.pid}`);

    // If we left AWAITING_PERMISSION via a non-resolution path (e.g. user approved
    // in terminal), clean up the stale pending permission and its timeout.
    if (prevState === State.AWAITING_PERMISSION && session.state !== State.AWAITING_PERMISSION && session.pendingPermission) {
      streamDeck.logger.info(`Clearing stale pending permission for session=${id} (transitioned away via ${event})`);
      this.clearPendingPermission(session);
    }

    // Auto-foreground sessions needing user attention
    if (event === "Elicitation") {
      this.focusSession(id);
    }

    // Event-specific side effects
    switch (event) {
      case "PreToolUse":
        session.currentTool = payload.tool_name ?? null;
        break;
      case "PostToolUse":
        session.currentTool = null;
        break;
      case "PostToolUseFailure":
        session.currentTool = null;
        session.lastError = payload.error ?? "Tool failed";
        break;
      case "SubagentStart":
        session.activeSubagents++;
        break;
      case "SubagentStop":
        session.activeSubagents = Math.max(0, session.activeSubagents - 1);
        break;
      case "Stop":
        session.currentTool = null;
        break;
      case "SessionEnd":
        this.clearPendingPermission(session);
        // Emit before deleting so listeners can still read the session
        this.emit("sessionUpdated", session, event);
        this.sessions.delete(id);
        this.clampActiveIndex();
        return session;
    }

    this.emit("sessionUpdated", session, event);
    return session;
  }

  /** Store the resolved PID for a session. Updated on every hook event to stay fresh. */
  setSessionPid(sessionId: string, pid: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pid = pid;
    }
  }

  /** Send SIGINT to the active session's Claude Code process. Returns true if signal was sent. */
  interruptActiveSession(): boolean {
    const session = this.activeSession;
    if (!session?.pid) return false;
    if (session.state === State.DISCONNECTED || session.state === State.IDLE) return false;
    try {
      process.kill(session.pid, "SIGINT");
      return true;
    } catch {
      return false;
    }
  }

  /** Bring a session to the foreground by ID. */
  focusSession(sessionId: string): void {
    const ids = [...this.sessions.keys()];
    const idx = ids.indexOf(sessionId);
    if (idx >= 0 && idx !== this._activeIndex) {
      this._activeIndex = idx;
      this.emit("activeSessionChanged", this.activeSession);
    }
  }

  setPendingPermission(sessionId: string, pending: PendingPermission): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.clearPendingPermission(session);
    session.pendingPermission = pending;
    if (!this.permissionQueue.includes(sessionId)) {
      this.permissionQueue.push(sessionId);
    }
    // Only auto-foreground if this is the first (or only) queued permission
    if (this.permissionQueue[0] === sessionId) {
      this.focusSession(sessionId);
    }
    this.emit("sessionUpdated", session, "PermissionRequest");
  }

  /**
   * Clear pending permission state without writing the HTTP response.
   * Used by the timeout handler in HookServer (which writes its own response).
   */
  clearPendingPermissionById(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.pendingPermission) return;
    clearTimeout(session.pendingPermission.timer);
    session.pendingPermission = null;
    session.state = State.PROCESSING;
    this.removeFromPermissionQueue(sessionId);
    this.emit("sessionUpdated", session, "PermissionRequest");
    this.advancePermissionQueue();
  }

  resolvePermission(sessionId: string, allow: boolean, reason?: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.pendingPermission) return false;

    const { res, timer } = session.pendingPermission;
    clearTimeout(timer);

    if (!res.writableEnded) {
      const body = allow
        ? { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } }
        : { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: reason ?? "Denied via Stream Deck" } } };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    }

    session.pendingPermission = null;
    // Agent continues processing after permission resolution
    session.state = State.PROCESSING;
    this.removeFromPermissionQueue(sessionId);
    this.emit("sessionUpdated", session, "PermissionRequest");
    this.advancePermissionQueue();
    return true;
  }

  private clearPendingPermission(session: SessionState): void {
    if (!session.pendingPermission) return;
    this.removeFromPermissionQueue(session.id);
    clearTimeout(session.pendingPermission.timer);
    try {
      if (!session.pendingPermission.res.writableEnded) {
        const body = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "Session ended" } } };
        session.pendingPermission.res.writeHead(200, { "Content-Type": "application/json" });
        session.pendingPermission.res.end(JSON.stringify(body));
      }
    } catch (err) {
      streamDeck.logger.warn(`Failed to write deny response for session=${session.id}: ${err}`);
    }
    session.pendingPermission = null;
  }

  private removeFromPermissionQueue(sessionId: string): void {
    const idx = this.permissionQueue.indexOf(sessionId);
    if (idx >= 0) this.permissionQueue.splice(idx, 1);
  }

  private advancePermissionQueue(): void {
    if (this.permissionQueue.length > 0) {
      const nextId = this.permissionQueue[0];
      this.focusSession(nextId);
      const next = this.sessions.get(nextId);
      if (next) this.emit("sessionUpdated", next, "PermissionRequest");
    }
  }

  private clampActiveIndex(): void {
    const count = this.sessions.size;
    if (count === 0) {
      this._activeIndex = 0;
    } else {
      this._activeIndex = Math.min(this._activeIndex, count - 1);
    }
  }

  private pruneStale(): void {
    const now = Date.now();
    // Collect stale IDs first to avoid mutating during iteration
    const staleIds: string[] = [];
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > STALE_MS && STALE_PRUNE_STATES.has(session.state)) {
        staleIds.push(id);
      }
    }
    for (const id of staleIds) {
      const session = this.sessions.get(id)!;
      this.clearPendingPermission(session);
      this.emit("sessionUpdated", { ...session, state: State.DISCONNECTED }, "SessionEnd");
      this.sessions.delete(id);
    }
    if (staleIds.length > 0) {
      this.clampActiveIndex();
    }
  }
}
