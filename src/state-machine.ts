import { type HookEventName, State } from "./types";

/**
 * Returns the next state given the current state and an incoming hook event.
 * Returns null if the transition is invalid / no-op.
 *
 * Guards prevent nonsensical transitions (e.g. tool events from DISCONNECTED).
 * The plugin may miss events (restart, network), so auto-created sessions
 * start as IDLE to remain permissive for late-arriving events.
 */
export function transition(current: State, event: HookEventName): State | null {
  switch (event) {
    case "SessionStart":
      return State.IDLE;

    case "SessionEnd":
      return State.DISCONNECTED;

    case "PreToolUse":
      return current === State.DISCONNECTED ? null : State.PROCESSING;

    case "PostToolUse":
    case "PostToolUseFailure":
      // Stay in PROCESSING — another tool may follow. Stop event moves to IDLE.
      // Also transition from AWAITING_PERMISSION → PROCESSING: this means the
      // permission was approved outside the plugin (e.g. in the terminal).
      return current === State.PROCESSING || current === State.AWAITING_PERMISSION
        ? State.PROCESSING
        : null;

    case "PermissionRequest":
      return current === State.DISCONNECTED ? null : State.AWAITING_PERMISSION;

    case "Elicitation":
      return current === State.DISCONNECTED ? null : State.AWAITING_ELICITATION;

    case "ElicitationResult":
      return current === State.AWAITING_ELICITATION ? State.IDLE : null;

    case "Stop":
      return current === State.DISCONNECTED ? null : State.IDLE;

    case "SubagentStart":
    case "SubagentStop":
    case "Notification":
      return null;

    default:
      return null;
  }
}
