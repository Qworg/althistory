import { makeProject } from '@revideo/core'
// Bundled, not system fonts, so the video renders the same on any machine.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/newsreader/600.css'
import walkthrough from './walkthrough'

export default makeProject({
  name: 'althistory-walkthrough',
  scenes: [walkthrough],
  settings: {
    shared: {
      background: '#0a1f3c',
      range: [0, Infinity],
      size: { x: 1920, y: 1080 },
    },
    rendering: {
      exporter: { name: '@revideo/core/wasm' },
      fps: 30,
      resolutionScale: 1,
      colorSpace: 'srgb',
    },
  },
})
