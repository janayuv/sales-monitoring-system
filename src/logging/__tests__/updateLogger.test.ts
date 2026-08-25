// src/logging/__tests__/updateLogger.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { UpdateLogger } from "../updateLogger";

describe("UpdateLogger", () => {
  beforeEach(async () => {
    localStorage.clear();
    await UpdateLogger.clearLogs();
    UpdateLogger.resetMetrics();
  });

  describe("Analytics Metrics", () => {
    it("returns zero default metrics when uninitialized", () => {
      const metrics = UpdateLogger.getMetrics();
      expect(metrics).toEqual({
        check_count: 0,
        download_success: 0,
        download_failure: 0,
        install_success: 0,
        install_failure: 0,
      });
    });

    it("increments individual metrics independently", () => {
      UpdateLogger.incrementMetric("check_count");
      UpdateLogger.incrementMetric("check_count");
      UpdateLogger.incrementMetric("download_success");
      UpdateLogger.incrementMetric("download_failure");
      UpdateLogger.incrementMetric("install_success");
      UpdateLogger.incrementMetric("install_failure");

      const metrics = UpdateLogger.getMetrics();
      expect(metrics.check_count).toBe(2);
      expect(metrics.download_success).toBe(1);
      expect(metrics.download_failure).toBe(1);
      expect(metrics.install_success).toBe(1);
      expect(metrics.install_failure).toBe(1);
    });

    it("resets all metrics to zero upon resetMetrics()", () => {
      UpdateLogger.incrementMetric("check_count");
      UpdateLogger.incrementMetric("download_failure");
      UpdateLogger.incrementMetric("install_failure");

      expect(UpdateLogger.getMetrics().check_count).toBe(1);
      UpdateLogger.resetMetrics();

      const metrics = UpdateLogger.getMetrics();
      expect(metrics).toEqual({
        check_count: 0,
        download_success: 0,
        download_failure: 0,
        install_success: 0,
        install_failure: 0,
      });
    });
  });

  describe("Structured Logging & History", () => {
    it("logs events and retrieves them newest first", async () => {
      await UpdateLogger.log("INFO", "Check Initiated", undefined, "Manual trigger");
      await UpdateLogger.log("WARN", "Update Skipped", "2.0.0", "User preference");
      await UpdateLogger.log("ERROR", "Download Failed", undefined, "Network timeout");

      const logs = await UpdateLogger.getLogs();
      expect(logs.length).toBe(3);
      expect(logs[0].event).toBe("Download Failed");
      expect(logs[0].level).toBe("ERROR");
      expect(logs[0].details).toBe("Network timeout");

      expect(logs[1].event).toBe("Update Skipped");
      expect(logs[1].version).toBe("2.0.0");
      expect(logs[1].level).toBe("WARN");

      expect(logs[2].event).toBe("Check Initiated");
      expect(logs[2].level).toBe("INFO");
    });

    it("slices logs to the requested linesCount limit", async () => {
      for (let i = 1; i <= 20; i++) {
        await UpdateLogger.log("INFO", "Action #" + i);
      }

      const logs = await UpdateLogger.getLogs(5);
      expect(logs.length).toBe(5);
      expect(logs[0].event).toBe("Action #20");
      expect(logs[4].event).toBe("Action #16");
    });

    it("clears logs properly when clearLogs() is invoked", async () => {
      await UpdateLogger.log("INFO", "Initial check");
      await UpdateLogger.log("INFO", "Downloading update");
      expect((await UpdateLogger.getLogs()).length).toBe(2);

      await UpdateLogger.clearLogs();
      const afterClear = await UpdateLogger.getLogs();
      expect(afterClear.length).toBe(0);
    });
  });
});
