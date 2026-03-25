import { SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";
import type { SessionManager } from "../session-manager";

let _manager: SessionManager;

export function setManager(m: SessionManager): void {
  _manager = m;
}

/**
 * Base class for actions that observe SessionManager state.
 * Handles listener binding and triggers render() on session changes.
 */
export abstract class ManagedAction extends SingletonAction {
  private listenersBound = false;

  protected get manager(): SessionManager {
    return _manager;
  }

  override onWillAppear(_ev: WillAppearEvent): void {
    if (!this.listenersBound && _manager) {
      _manager.on("sessionUpdated", () => this.render());
      _manager.on("activeSessionChanged", () => this.render());
      this.listenersBound = true;
    }
    this.render();
  }

  protected abstract render(): void;
}
