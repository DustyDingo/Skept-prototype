import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        verify: 'verify.html',
        history: 'history.html',
        settings: 'settings.html',
      },
    },
  },
});
