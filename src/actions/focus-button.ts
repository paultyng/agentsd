import streamDeck, { action, type KeyDownEvent, SingletonAction } from "@elgato/streamdeck";
import { focusClaudeDesktop, focusGhostty } from "../util/applescript";

@action({ UUID: "com.paultyng.agentsd.focus" })
export class FocusButton extends SingletonAction {
  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    try {
      await focusGhostty();
    } catch {
      try {
        await focusClaudeDesktop();
      } catch (err) {
        streamDeck.logger.warn(`Failed to focus any application: ${err}`);
      }
    }
  }
}
