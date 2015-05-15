'use strict';

var busClient  = require ('xcraft-core-busclient').global;


module.exports = function () {
  return {
    token:     busClient.getToken (),
    orcName:   busClient.getStateWhich (),
    timestamp: new Date ().toISOString (),
    data:      {}
  };
};
