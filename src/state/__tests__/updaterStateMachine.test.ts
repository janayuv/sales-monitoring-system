// src/state/__tests__/updaterStateMachine.test.ts
import { describe, it, expect } from "vitest";
import { isValidTransition } from "../updaterStateMachine";

describe("updaterStateMachine", () => {
  it("allows valid transitions through the update happy path", () => {
    expect(isValidTransition("Idle", "Checking")).toBe(true);
    expect(isValidTransition("Checking", "UpdateAvailable")).toBe(true);
    expect(isValidTransition("UpdateAvailable", "Downloading")).toBe(true);
    expect(isValidTransition("Downloading", "Downloaded")).toBe(true);
    expect(isValidTransition("Downloaded", "Installing")).toBe(true);
    expect(isValidTransition("Installing", "Installed")).toBe(true);
    expect(isValidTransition("Installed", "RestartRequired")).toBe(true);
    expect(isValidTransition("RestartRequired", "Idle")).toBe(true);
  });

  it("allows transition from Checking to NoUpdate and back to Checking", () => {
    expect(isValidTransition("Checking", "NoUpdate")).toBe(true);
    expect(isValidTransition("NoUpdate", "Checking")).toBe(true);
    expect(isValidTransition("NoUpdate", "Idle")).toBe(true);
  });

  it("allows transition to Failed on errors during check, download, or install", () => {
    expect(isValidTransition("Checking", "Failed")).toBe(true);
    expect(isValidTransition("Downloading", "Failed")).toBe(true);
    expect(isValidTransition("Downloaded", "Failed")).toBe(true);
    expect(isValidTransition("Installing", "Failed")).toBe(true);
    expect(isValidTransition("Failed", "Checking")).toBe(true);
    expect(isValidTransition("Failed", "Idle")).toBe(true);
  });

  it("allows user cancellation from appropriate states", () => {
    expect(isValidTransition("UpdateAvailable", "Cancelled")).toBe(true);
    expect(isValidTransition("Downloading", "Cancelled")).toBe(true);
    expect(isValidTransition("Cancelled", "Idle")).toBe(true);
    expect(isValidTransition("Cancelled", "Checking")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(isValidTransition("Idle", "Downloaded")).toBe(false);
    expect(isValidTransition("Idle", "Installing")).toBe(false);
    expect(isValidTransition("NoUpdate", "Downloading")).toBe(false);
    expect(isValidTransition("Installed", "Downloading")).toBe(false);
    expect(isValidTransition("RestartRequired", "Downloading")).toBe(false);
  });
});
