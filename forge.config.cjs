module.exports = {
  packagerConfig: {
    asar: true,
    name: 'AquaCycle',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'aquacycle',
        authors: 'AquaCycle Project',
        noMsi: true,
      },
      platforms: ['win32'],
    },
    {
      name: '@electron-forge/maker-zip',
      // The Windows zip is the no-installer portable build: extract it and
      // launch AquaCycle.exe without Node.js or other development tools.
      platforms: ['darwin', 'win32'],
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
      },
      platforms: ['darwin'],
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        concurrent: false,
        build: [
          {
            entry: 'src/main.ts',
            config: 'vite.main.config.ts',
          },
          {
            entry: 'src/preload.ts',
            config: 'vite.preload.config.ts',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.ts',
          },
        ],
      },
    },
  ],
};
