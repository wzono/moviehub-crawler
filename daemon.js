const { exec } = require("child_process");
const { isPortOccupied, sleep } = require("./utils.js");


function restart() {
  return new Promise(resolve => {
    exec("kill `ps -ef | grep SAPI | grep -v grep | awk '{print $2}'`", function () {
      exec("open /Applications/SAPI.app", function (err) {
        resolve()
      });
    })
  })
}

async function main() {
  let isProxyServerPortOccupied = false;

  while (true) {
    isProxyServerPortOccupied = await isPortOccupied(9528);
    if (!isProxyServerPortOccupied) {
      await restart()
    }
    await sleep(2000);
  }
}

main();