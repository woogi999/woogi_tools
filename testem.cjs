'use strict';

if (typeof module !== 'undefined') {
  module.exports = {
    test_page: 'tests/index.html?hidepassed',
    disable_watching: true,
    launch_in_ci: ['Chrome'],
    launch_in_dev: ['Chrome'],
    browser_start_timeout: 120,
    browser_args: {
      Chrome: {
        ci: [
          // --no-sandbox is needed when running Chrome inside a container
          process.env.CI ? '--no-sandbox' : null,
          '--headless',
          '--disable-dev-shm-usage',
          // CI runners have no GPU, so WebGL has to come from SwiftShader.
          // Do not put --disable-software-rasterizer back: it turns SwiftShader
          // off, and the shader tests then fail with "no WebGL2" on CI while
          // still passing on any machine with a real graphics card.
          '--use-gl=angle',
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
          '--mute-audio',
          '--remote-debugging-port=0',
          '--window-size=1440,900',
        ].filter(Boolean),
      },
    },
  };
}
