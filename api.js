const { genCookie, genUserAgent } = require("./utils");

const request = require('promise-request-retry');

function getAllNodes() {
  return new Promise(resolve => {
    request({
      url: "http://localhost:9528/servers",
      method: "GET"
    }).then(response => {
      const data = JSON.parse(response) || [];
      resolve(data.map(({ Id }) => Id));
    }).catch(console.log);
  });
}

function toggleNode(nodeId) {
  return request({
    url: "http://localhost:9528/current",
    method: "put",
    form: { Id: nodeId },
    timeout: 5000,
  })
}

module.exports = {
  getAllNodes,
  toggleNode,
}