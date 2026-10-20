import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// La app se publica en https://juhabararj.github.io/guitart/
export default defineConfig({
  base: '/guitart/',
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // TensorFlow.js y Basic Pitch en un archivo aparte que solo se carga al usar la detección con IA
        manualChunks: (id) => (id.includes('@tensorflow') || id.includes('@spotify/basic-pitch') ? 'tfjs' : undefined)
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Guitart',
        short_name: 'Guitart',
        description: 'Afinador, monitor y grabación para guitarra en el navegador',
        lang: 'es',
        theme_color: '#1E262C',
        background_color: '#1E262C',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // El motor de IA (TensorFlow.js) es grande: se descarga y se guarda la primera vez que se usa
        globIgnores: ['**/tfjs*.js', '**/index-*.js.map'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/models/') || /\/assets\/tfjs.*\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'guitart-ia', expiration: { maxEntries: 10 } }
          }
        ]
      }
    })
  ]
});
