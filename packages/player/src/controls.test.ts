import { describe, it, expect, vi } from "vitest";
import { type ControlsCallbacks, createControls } from "./controls";

function noopCallbacks(): ControlsCallbacks {
  return {
    onPlay: () => {},
    onPause: () => {},
    onSeek: () => {},
    onSpeedChange: () => {},
    onMuteToggle: () => {},
    onVolumeChange: () => {},
  };
}

describe("createControls host listeners", () => {
  it("removes every host listener it added on destroy", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const addSpy = vi.spyOn(host, "addEventListener");
    const removeSpy = vi.spyOn(host, "removeEventListener");

    const api = createControls(host, noopCallbacks());

    // Capture the exact handler references registered on the host element.
    const added = new Map<string, EventListenerOrEventListenerObject>();
    for (const [type, handler] of addSpy.mock.calls) {
      added.set(type, handler as EventListenerOrEventListenerObject);
    }
    expect(added.has("mousemove")).toBe(true);
    expect(added.has("mouseleave")).toBe(true);

    api.destroy();

    // Each host listener must be torn down with the same reference; anonymous
    // handlers (the previous bug) could never be removed, so toggling the
    // `controls` attribute leaked a duplicate pair on every cycle.
    for (const [type, handler] of added) {
      expect(removeSpy).toHaveBeenCalledWith(type, handler);
    }

    host.remove();
  });

  it("stops reacting to host mousemove after destroy", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const api = createControls(host, noopCallbacks());
    const controls = host.querySelector<HTMLElement>(".hfp-controls");
    expect(controls).not.toBeNull();

    api.destroy();

    // A mousemove after destroy must not revive the controls overlay.
    controls!.classList.add("hfp-hidden");
    host.dispatchEvent(new Event("mousemove"));
    expect(controls!.classList.contains("hfp-hidden")).toBe(true);

    host.remove();
  });

  it("removes its controls element from the host on destroy", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const api = createControls(host, noopCallbacks());
    const controls = host.querySelector<HTMLElement>(".hfp-controls");
    expect(controls).not.toBeNull();

    api.destroy();

    expect(host.querySelector(".hfp-controls")).toBeNull();
    expect(controls!.isConnected).toBe(false);

    host.remove();
  });
});

function touchEvent(type: string, clientX: number, timeStamp: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" || type === "touchcancel" ? [] : [{ clientX }],
  });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
}

function mouseEvent(type: string, clientX: number, timeStamp: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
}

describe("createControls touch input", () => {
  function setup(callbacks: Partial<ControlsCallbacks> = {}) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const api = createControls(host, { ...noopCallbacks(), ...callbacks });
    const controls = host.querySelector<HTMLElement>(".hfp-controls")!;
    const scrubber = host.querySelector<HTMLElement>(".hfp-scrubber")!;
    vi.spyOn(scrubber, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 4));
    const cleanup = () => {
      api.destroy();
      host.remove();
    };
    return { host, api, controls, scrubber, cleanup };
  }

  it("reveals auto-hidden controls when the player is touched", () => {
    const { host, api, controls, cleanup } = setup();
    api.updatePlaying(true);
    controls.classList.add("hfp-hidden");

    host.dispatchEvent(touchEvent("touchstart", 10, 0));

    expect(controls.classList.contains("hfp-hidden")).toBe(false);
    cleanup();
  });

  it("ignores the emulated mouse events a tap on the scrubber produces", () => {
    const onSeek = vi.fn();
    const onScrubStart = vi.fn();
    const onScrubEnd = vi.fn();
    const { scrubber, cleanup } = setup({ onSeek, onScrubStart, onScrubEnd });

    scrubber.dispatchEvent(touchEvent("touchstart", 50, 1000));
    document.dispatchEvent(touchEvent("touchend", 50, 1050));
    scrubber.dispatchEvent(mouseEvent("mousedown", 50, 1100));
    document.dispatchEvent(mouseEvent("mouseup", 50, 1110));

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(0.25);
    expect(onScrubStart).toHaveBeenCalledTimes(1);
    expect(onScrubEnd).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("still handles a real mouse press long after a touch", () => {
    const onSeek = vi.fn();
    const { scrubber, cleanup } = setup({ onSeek });

    scrubber.dispatchEvent(touchEvent("touchstart", 50, 1000));
    document.dispatchEvent(touchEvent("touchend", 50, 1050));
    scrubber.dispatchEvent(mouseEvent("mousedown", 100, 5000));

    expect(onSeek).toHaveBeenLastCalledWith(0.5);
    expect(onSeek).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("ends the scrub when the system cancels the touch", () => {
    const onScrubEnd = vi.fn();
    const onSeek = vi.fn();
    const { scrubber, cleanup } = setup({ onScrubEnd, onSeek });

    scrubber.dispatchEvent(touchEvent("touchstart", 50, 0));
    document.dispatchEvent(touchEvent("touchcancel", 50, 10));
    expect(onScrubEnd).toHaveBeenCalledTimes(1);

    // A later stray touchmove must not keep seeking.
    document.dispatchEvent(touchEvent("touchmove", 150, 20));
    expect(onSeek).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
