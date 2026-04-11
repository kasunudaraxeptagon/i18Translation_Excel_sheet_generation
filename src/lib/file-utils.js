const fs = require("fs-extra");

function safeReadJson(filePath) {
  try {
    return fs.readJsonSync(filePath);
  } catch (error) {
    return null;
  }
}

module.exports = {
  safeReadJson,
};
