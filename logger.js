const { getDateTimeString } = require("./utils");

let debug = false; // 是否调试状态，调试状态下会显示debug类型的日志

exports.enabledebug = function () {
  debug = true;
}
exports.disabledebug = function () {
  debug = false;
}

exports.log = function (msg) {
  console.log(getDateTimeString() + " " + msg);
}

exports.debug = function (msg) {
  if (debug)
    console.log("DEBUG: " + getDateTimeString() + " " + msg);
}

exports.error = function (msg) {
  console.log("ERROR: " + getDateTimeString() + " " + msg);
}