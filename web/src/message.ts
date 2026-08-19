export type ReactToGodotMessage =
  | {
      type: "START_SIMULATION";
    }
  | {
      type: "PAUSE_SIMULATION";
    }
  | {
      type: "STOP_SIMULATION";
    }
  | {
      type: "SET_SPEED";
      speed: number;
    };

export function sendToGodot(
  iframe: HTMLIFrameElement | null,
  message: ReactToGodotMessage
) {
  if (!iframe?.contentWindow) {
    console.warn("Godot iframe is not ready");
    return;
  }

  iframe.contentWindow.postMessage(message, "*");
}