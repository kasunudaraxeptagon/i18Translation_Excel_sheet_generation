const path = require("path");

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function toList(value) {
  if (value === undefined || value === null) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolvePathFromCwd(value) {
  if (!value) {
    return "";
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(process.cwd(), value);
}

module.exports = {
  parseArgs,
  resolvePathFromCwd,
  toBoolean,
  toList,
};
