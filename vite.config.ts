import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        // ffmpeg-static ships a tiny JS shim that resolves the platform
        // binary's path via `path.join(__dirname, 'ffmpeg')` — bundling
        // that shim into dist-electron/ changes its __dirname, so the
        // resolved path points at dist-electron/ffmpeg (never copied
        // there) instead of the real binary sitting next to the shim in
        // node_modules/ffmpeg-static/. Keeping it external leaves a plain
        // require('ffmpeg-static') in the output, resolved from
        // node_modules at runtime like any other dependency.
        vite: {
          build: {
            rollupOptions: {
              external: ['ffmpeg-static'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/'),
    },
  },
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
})
