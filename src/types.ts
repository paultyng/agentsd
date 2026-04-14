import type { IncomingMessage, ServerResponse } from "node:http";

export enum State {
  DISCONNECTED = "DISCONNECTED",
  IDLE = "IDLE",
  PROCESSING = "PROCESSING",
  AWAITING_PERMISSION = "AWAITING_PERMISSION",
  AWAITING_ELICITATION = "AWAITING_ELICITATION",
}

export type HookEventName =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Stop"
  | "StopFailure"
  | "PermissionRequest"
  | "Notification"
  | "SubagentStart"
  | "SubagentStop"
  | "TaskCreated"
  | "TaskCompleted"
  | "Elicitation"
  | "ElicitationResult";

export interface HookPayload {
  /** Unique session identifier */
  session_id: string;
  /** Working directory of the Claude Code session */
  cwd?: string;
  /** Permission mode (e.g. "default", "plan", "bypassPermissions") */
  permission_mode?: string;
  /** Tool name for PreToolUse/PostToolUse events */
  tool_name?: string;
  /** Error message for PostToolUseFailure */
  error?: string;
  /** Notification text */
  message?: string;
  /** Model identifier (present on SessionStart) */
  model?: string;
  /** Path to the session transcript JSONL file */
  transcript_path?: string;
}

export interface PendingPermission {
  req: IncomingMessage;
  res: ServerResponse;
  toolName?: string;
  /** Timeout handle — cleared on resolution or cleanup. */
  timer: ReturnType<typeof setTimeout>;
}

export interface SessionState {
  id: string;
  state: State;
  cwd: string;
  permissionMode: string;
  currentTool: string | null;
  activeWork: number;
  lastError: string | null;
  model: string | null;
  pendingPermission: PendingPermission | null;
  /** PID of the Claude Code process, resolved from hook connection. */
  pid: number | null;
  /** Epoch ms of last hook event, used for stale-session pruning. */
  lastActivity: number;
}
