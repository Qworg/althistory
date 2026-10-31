import { makeProject } from '@revideo/core'
// Bundled, not system fonts, so the video renders the same on any machine.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/jetbrains-mono/400.css'
import walkthrough from './walkthrough'

export default makeProject({
  name: 'althistory-walkthrough',
  scenes: [walkthrough],
  settings: {
    shared: {
      background: '#0b1020',
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
