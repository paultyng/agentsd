import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { iconButton } from "../util/svg";

@action({ UUID: "com.paultyng.agentsd.stop" })
export class StopButton extends ManagedAction {
  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    const sent = this.manager?.interruptActiveSession() ?? false;
    if (!sent) {
      streamDeck.logger.warn("Stop: no active session or PID not resolved");
    }
  }

  protected render(): void {
    const session = this.manager?.activeSession;
    const active = session && session.state !== State.DISCONNECTED && session.state !== State.IDLE;
    const icon = iconButton(
      active ? "#da3633" : "#555555",
      `<rect x="44" y="44" width="56" height="56" rx="8" fill="white"/>`,
    );
    for (const act of this.actions) {
      act.setTitle("Stop");
      act.setImage(icon);
    }
  }
}
