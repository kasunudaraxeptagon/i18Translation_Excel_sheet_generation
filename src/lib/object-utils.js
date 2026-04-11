function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function flattenObject(obj, prefix = "", result = {}) {
  if (!isObject(obj)) {
    return result;
  }

  for (const [key, value] of Object.entries(obj)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (isObject(value)) {
      flattenObject(value, nextKey, result);
    } else {
      result[nextKey] = value;
    }
  }

  return result;
}

function setNested(obj, keyPath, value) {
  const parts = String(keyPath || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return;
  }

  let current = obj;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const isLast = index === parts.length - 1;

    if (isLast) {
      current[part] = value;
    } else {
      if (!isObject(current[part])) {
        current[part] = {};
      }
      current = current[part];
    }
  }
}

function hasNested(obj, keyPath) {
  const parts = String(keyPath || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  let cursor = obj;

  for (const part of parts) {
    if (!isObject(cursor) || !(part in cursor)) {
      return false;
    }

    cursor = cursor[part];
  }

  return true;
}

function getLeafType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

module.exports = {
  deepClone,
  flattenObject,
  getLeafType,
  hasNested,
  isObject,
  setNested,
};
