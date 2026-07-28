// src/state/updaterStateMachine.ts
import { UpdateState } from "../types/updater";

export const UPDATER_TRANSITIONS: Record<UpdateState, UpdateState[]> = {
  Idle: ["Checking"],
  Checking: ["NoUpdate", "UpdateAvailable", "Failed"],
  NoUpdate: ["Idle", "Checking"],
  UpdateAvailable: ["Downloading", "Cancelled", "Idle"],
  Downloading: ["Downloaded", "Failed", "Cancelled"],
  Downloaded: ["Installing", "Failed"],
  Installing: ["Installed", "Failed"],
  Installed: ["RestartRequired"],
  RestartRequired: ["Idle"],
  Cancelled: ["Idle", "Checking"],
  Failed: ["Idle", "Checking"],
};

export function isValidTransition(from: UpdateState, to: UpdateState): boolean {
  const allowed = UPDATER_TRANSITIONS[from];
  return allowed.includes(to);
}
