function createLogger(level = "info") {
  const levels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };

  const activeLevel = levels[level] ?? levels.info;

  function log(logLevel, message, details) {
    if ((levels[logLevel] ?? levels.info) > activeLevel) {
      return;
    }

    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${logLevel.toUpperCase()}]`;

    if (details === undefined) {
      console.log(`${prefix} ${message}`);
      return;
    }

    if (typeof details === "string") {
      console.log(`${prefix} ${message} ${details}`);
      return;
    }

    console.log(`${prefix} ${message} ${JSON.stringify(details)}`);
  }

  return {
    error: (message, details) => log("error", message, details),
    warn: (message, details) => log("warn", message, details),
    info: (message, details) => log("info", message, details),
    debug: (message, details) => log("debug", message, details),
  };
}

module.exports = {
  createLogger,
};
