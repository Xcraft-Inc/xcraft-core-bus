'use strict';

const path = require('node:path');
const {fse} = require('xcraft-core-fs');

function removeExtraBuilds() {
  const tools = require('koffi/src/cnoke/src/tools.js');

  const koffiPath = path.dirname(require.resolve('koffi'));
  const buildPath = path.join(koffiPath, 'build/koffi');

  const {platform} = process;
  const arch = tools.determine_arch();
  const target = `${platform}_${arch}`;

  const directories = fse.readdirSync(buildPath);
  for (const dir of directories) {
    if (dir !== target) {
      const extraTargetPath = path.join(buildPath, dir);
      console.log(`Unlink extra build: ${extraTargetPath}`);
      fse.removeSync(extraTargetPath);
    }
  }
}

removeExtraBuilds();
