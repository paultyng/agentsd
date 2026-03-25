import { action, type DialRotateEvent, type WillAppearEvent } from "@elgato/streamdeck";
import { basename } from "node:path";
import { ManagedAction } from "./base";

@action({ UUID: "com.paultyng.agentsd.session-dial" })
export class SessionDial extends ManagedAction {
  override onWillAppear(ev: WillAppearEvent): void {
    super.onWillAppear(ev);
    if (ev.action.isDial()) {
      ev.action.setFeedbackLayout("$A1");
    }
  }

  override onDialRotate(ev: DialRotateEvent): void {
    const direction = ev.payload.ticks > 0 ? 1 : -1;
    this.manager?.cycleSession(direction);
  }

  protected render(): void {
    const session = this.manager?.activeSession;
    const title = session ? basename(session.cwd) : "No Session";
    const count = this.manager?.sessionCount ?? 0;
    const idx = this.manager?.activeIndex ?? 0;

    for (const act of this.actions) {
      if (act.isDial()) {
        act.setFeedback({
          title,
          value: count > 0 ? `${idx + 1}/${count}` : "—",
        });
      } else {
        act.setTitle(title);
      }
    }
  }
}
