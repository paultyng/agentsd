import { vi } from "vitest";

// Replace the @elgato/streamdeck import with a no-op logger and action stubs.
// SessionManager and HookServer only touch `streamDeck.logger.*`; this keeps
// the plugin's source unchanged while letting tests run without the SDK runtime.
vi.mock("@elgato/streamdeck", () => {
  const logger = {
    setLevel: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
  return {
    default: {
      logger,
      actions: { registerAction: vi.fn() },
      connect: vi.fn(),
    },
  };
});
