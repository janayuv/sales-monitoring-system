export interface TelemetryEvent {
  eventName: string;
  category: "storage" | "export" | "render" | "user_action";
  details?: Record<string, any>;
  timestamp: string;
}

export class TableTelemetry {
  private static events: TelemetryEvent[] = [];

  static log(category: TelemetryEvent["category"], eventName: string, details?: Record<string, any>) {
    const event: TelemetryEvent = {
      category,
      eventName,
      details,
      timestamp: new Date().toISOString(),
    };
    this.events.push(event);

    // Keep log buffer bounded to last 100 entries
    if (this.events.length > 100) {
      this.events.shift();
    }

    if (process.env.NODE_ENV === "development") {
      console.debug(`[TableTelemetry:${category}] ${eventName}`, details || "");
    }
  }

  static getRecentLogs(): TelemetryEvent[] {
    return [...this.events];
  }
}
