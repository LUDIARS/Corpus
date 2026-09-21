const path = require('node:path');

const desktopConfig = require('./corpus.desktop.json');

module.exports = {
  outDir: 'dist',
  packagerConfig: {
    asar: true,
    name: desktopConfig.productName,
    executableName: desktopConfig.serviceId,
    extraResource: [
      path.join(__dirname, 'corpus.desktop.json'),
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: desktopConfig.serviceId,
        authors: 'LUDIARS',
        description: 'Enterprise capability hub powered by Corpus',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux'],
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
};
