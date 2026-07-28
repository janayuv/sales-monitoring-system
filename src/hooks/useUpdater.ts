// src/hooks/useUpdater.ts
import { useContext, useEffect } from "react";
import { UpdaterContext, UpdaterContextType } from "../context/UpdaterContext";

export function useUpdater(): UpdaterContextType {
  const context = useContext(UpdaterContext);
  if (!context) {
    throw new Error("useUpdater must be used within an UpdaterProvider");
  }
  return context;
}

/**
 * Hook to manage automatic update scheduling checks.
 */
export function useUpdaterScheduler(): void {
  const { autoCheck, checkSchedule, lastCheckTime, state, checkForUpdates } = useUpdater();

  useEffect(() => {
    if (!autoCheck || state !== "Idle") return;

    const performBackgroundCheck = async () => {
      // Offline safety check
      if (!navigator.onLine) {
        console.log("[UpdaterScheduler] Offline, skipping background update check.");
        return;
      }

      // Check schedule parameters
      const now = Date.now();
      const lastCheck = lastCheckTime ? new Date(lastCheckTime).getTime() : 0;
      const hoursSinceCheck = (now - lastCheck) / (1000 * 60 * 60);

      let shouldCheck = false;

      if (checkSchedule === "startup") {
        shouldCheck = lastCheck === 0 || hoursSinceCheck >= 0.1; // small debounce for startup
      } else if (checkSchedule === "daily") {
        shouldCheck = lastCheck === 0 || hoursSinceCheck >= 24;
      } else if (checkSchedule === "weekly") {
        shouldCheck = lastCheck === 0 || hoursSinceCheck >= 24 * 7;
      }

      if (shouldCheck) {
        console.log(`[UpdaterScheduler] Triggering automatic update check (${checkSchedule}).`);
        try {
          await checkForUpdates(false); // force = false to support skipping version
        } catch (e) {
          console.error("[UpdaterScheduler] Background check failed:", e);
        }
      }
    };

    // Wait 7 seconds after app startup before checking, so launch is fast and smooth
    const timer = setTimeout(() => {
      performBackgroundCheck();
    }, 7000);

    return () => clearTimeout(timer);
  }, [autoCheck, checkSchedule, lastCheckTime, state, checkForUpdates]);
}
