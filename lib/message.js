'use strict';
var busClient  = require ('xcraft-core-busclient');


module.exports = function () {
  return {
    token    : busClient.getToken (),
    timestamp: new Date ().toISOString (),
    data     : {}
  };
};
