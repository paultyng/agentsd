import { describe, it, expect } from "vitest";
import { transition } from "../src/state-machine";
import { State } from "../src/types";

describe("state-machine.transition", () => {
  it("ElicitationResult: AWAITING_ELICITATION returns IDLE", () => {
    expect(transition(State.AWAITING_ELICITATION, "ElicitationResult")).toBe(State.IDLE);
  });

  it("ElicitationResult: any other state returns null (no-op)", () => {
    expect(transition(State.IDLE, "ElicitationResult")).toBeNull();
    expect(transition(State.PROCESSING, "ElicitationResult")).toBeNull();
    expect(transition(State.AWAITING_PERMISSION, "ElicitationResult")).toBeNull();
    expect(transition(State.DISCONNECTED, "ElicitationResult")).toBeNull();
  });

  it("non-state-changing events return null regardless of current state", () => {
    for (const event of ["SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "Notification"] as const) {
      for (const state of Object.values(State)) {
        expect(transition(state, event)).toBeNull();
      }
    }
  });

  it("DISCONNECTED is a sink for tool/prompt events", () => {
    expect(transition(State.DISCONNECTED, "PreToolUse")).toBeNull();
    expect(transition(State.DISCONNECTED, "UserPromptSubmit")).toBeNull();
    expect(transition(State.DISCONNECTED, "PermissionRequest")).toBeNull();
    expect(transition(State.DISCONNECTED, "Elicitation")).toBeNull();
    expect(transition(State.DISCONNECTED, "Stop")).toBeNull();
  });
});
