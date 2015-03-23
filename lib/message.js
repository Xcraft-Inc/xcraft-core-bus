'use strict';
var busClient  = require ('xcraft-core-busclient');


module.exports = function () {
  return {
    token:     busClient.getToken (),
    orcName:   busClient.getOrcName (),
    timestamp: new Date ().toISOString (),
    data:      {}
  };
};
