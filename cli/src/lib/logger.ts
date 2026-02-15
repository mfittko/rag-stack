interface LoggerOptions {
  quiet?: boolean;
  json?: boolean;
}

class Logger {
  private options: LoggerOptions;

  constructor(options: LoggerOptions = {}) {
    this.options = options;
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.options.quiet) return;
    
    if (this.options.json) {
      console.log(JSON.stringify({ level: "info", message, ...data }));
    } else {
      console.log(message);
      if (data) {
        console.log(data);
      }
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.options.quiet) return;
    
    if (this.options.json) {
      console.warn(JSON.stringify({ level: "warn", message, ...data }));
    } else {
      console.warn(message);
      if (data) {
        console.warn(data);
      }
    }
  }

  error(message: string, error?: unknown): void {
    if (this.options.json) {
      const errorData = error instanceof Error ? { error: error.message, stack: error.stack } : { error };
      console.error(JSON.stringify({ level: "error", message, ...errorData }));
    } else {
      console.error(message);
      if (error) {
        console.error(error);
      }
    }
  }

  setOptions(options: LoggerOptions): void {
    this.options = { ...this.options, ...options };
  }
}

export const logger = new Logger();
