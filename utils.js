const { USER_AGENTS}  = require("./conf");

const net = require('net')
const mysql = require("mysql2/promise")

module.exports = {
  sleep,
  isPortOccupied,
  take,
  genUserAgent,
  genCookie,
  shuffle,
  isContain,
  genWhere,
  isBanned,
  getDateTimeString,
  genSegmentArray,
  random,
  getDateString,
  removeCharAndSpace,
  remove,
}

function removeCharAndSpace(s = '') {
  return s.replace(/[a-zA-Z\s|.\\\/]/g, '')
}

//获取当前日期字符串
function getDateString (d) {
  if (!d) d = new Date();
  let yyyy = d.getFullYear().toString();
  let mm = (d.getMonth() + 1).toString();
  let dd = d.getDate().toString();
  return yyyy + "-" + (mm[1] ? mm : "0" + mm) + "-" + (dd[1] ? dd : "0" + dd);
}

function random(min, max) {
  return Math.round(Math.random() * (max - min)) + min;
}

function isBanned($) {
  return !($("#comments-section .mod-hd h2 i").text() || "").trim();
}

function genSegmentArray(min = 0, max = 5000, size = 100, callback) {
  const len = Math.floor(max / size)
  return new Array(len).fill(1).map((_, i) => {
    const start = i * size;
    const dest = start + size - 1 > max ? max : start + size - 1
    return callback(start, dest, size)
  })
}

function shuffle(array) {
  let m = array.length,
    t,
    i;
  while (m) {
    i = Math.floor(Math.random() * m--);
    t = array[m];
    array[m] = array[i];
    array[i] = t;
  }
  return array;
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

function take(array = []) {
  return array[random(0, array.length)];
}

function genUserAgent() {
  return take(USER_AGENTS)
}

function getRandomString(length = 11) {
  const charset =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return new Array(length)
    .fill(1)
    .map(() => take(charset))
    .join("");
}

function genCookie() {
  return `bid=${getRandomString(11)}`
}

function isPortOccupied(port) {
  const server = net.createServer().listen(port, "localhost");
  return new Promise(resolve => {
    server.on("listening", () => {
      server.close();
      resolve(false);
    });

    server.on("error", () => {
      resolve(true);
    });
  });
}

function getDateTimeString(d) {
  if (!d) d = new Date();
  const yyyy = d.getFullYear().toString();
  const mm = (d.getMonth() + 1).toString();
  const dd = d.getDate().toString();
  const hh = d.getHours().toString();
  const mi = d.getMinutes().toString();
  const ss = d.getSeconds().toString();
  return yyyy + "-" + (mm[1] ? mm : "0" + mm) + "-" + (dd[1] ? dd : "0" + dd) + " " + (hh[1] ? hh : "0" + hh) + ":" + (mi[1] ? mi : "0" + mi) + ":" + (ss[1] ? ss : "0" + ss);

}

function gen(obj) {
  const [keys, values] = Object.entries(obj).reduce(
    (acc, cur) => {
      const [key, value] = cur;
      acc[0].push(key);
      acc[1].push(value);
      return acc;
    },
    [[], []]
  );
  return [keys.join(","), values];
}

function genWhere(obj) {
  return Object.entries(obj)
    .map(kv => {
      const [k, v] = kv;
      return `\`${k}\` = ${mysql.escape(v)}`;
    })
    .join(" AND ");
}

function remove(item, arr = []) {
  let index = arr.indexOf(item)
  let exist = index !== -1
  exist && arr.splice(index, 1)
}

function isContain(str = '', arr = []) {
  return arr.some(s => str.toLowerCase().indexOf(s.toLowerCase()) !== -1)
}


