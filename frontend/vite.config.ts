import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { cpSync, mkdirSync } from 'node:fs'

export default defineConfig({
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [react(), {
    name: 'local-pdf-assets',
    writeBundle() {
      for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
        mkdirSync(`dist/pdf/${directory}`, { recursive: true })
        cpSync(`node_modules/pdfjs-dist/${directory}`, `dist/pdf/${directory}`, { recursive: true })
      }
    },
    configureServer(server) {
      server.middlewares.use('/pdf', async (req, res, next) => {
        const { createReadStream } = await import('node:fs')
        const { resolve, sep } = await import('node:path')
        const root = resolve('node_modules/pdfjs-dist')
        const path = resolve(root, '.' + (req.url?.split('?')[0] ?? ''))
        if (!path.startsWith(root + sep) || !/^(cmaps|standard_fonts|wasm)\//.test(path.slice(root.length + 1).split(sep).join('/'))) return next()
        const stream = createReadStream(path)
        stream.on('error', () => { res.statusCode = 404; res.end() })
        if (path.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm')
        stream.pipe(res)
      })
    },
  }],
  server: { proxy: { '/api': 'http://127.0.0.1:5001' } },
  test: { testTimeout: 15000, environment: 'jsdom', include: ['tests/**/*.test.{ts,tsx}'], setupFiles: ['tests/testSetup.ts'] },
})
