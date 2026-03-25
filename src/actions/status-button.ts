import { action } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { iconButton } from "../util/svg";

const AGENT_COLORS = ["#1f6feb", "#d29922", "#e16f24", "#da3633"];

function agentColor(count: number): string | null {
  if (count <= 0) return null;
  return AGENT_COLORS[Math.min(count - 1, AGENT_COLORS.length - 1)];
}

@action({ UUID: "com.paultyng.agentsd.status" })
export class StatusButton extends ManagedAction {
  protected render(): void {
    const session = this.manager?.activeSession;
    if (!session) {
      for (const act of this.actions) act.setTitle("—");
      return;
    }

    const lines: string[] = [];
    switch (session.state) {
      case State.PROCESSING:
        lines.push("Working");
        if (session.currentTool) lines.push(session.currentTool);
        break;
      case State.AWAITING_PERMISSION:
        lines.push("Permission?");
        break;
      case State.AWAITING_ELICITATION:
        lines.push("Question?");
        break;
      case State.IDLE:
        lines.push("Idle");
        break;
      default:
        lines.push(session.state);
    }

    if (session.activeSubagents > 0) {
      lines.push("", `${session.activeSubagents} agent${session.activeSubagents > 1 ? "s" : ""}`);
    }

    const text = lines.join("\n");
    const color = agentColor(session.activeSubagents);

    for (const act of this.actions) {
      act.setTitle(text);
      act.setImage(color ? iconButton(color, "") : undefined);
    }
  }
}
