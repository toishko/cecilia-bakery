import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        menu: resolve(__dirname, 'menu.html'),
        login: resolve(__dirname, 'login.html'),
        adminLogin: resolve(__dirname, 'admin-login.html'),
        driverLogin: resolve(__dirname, 'driver-login.html'),
        partnerLogin: resolve(__dirname, 'partner-login.html'),
        extractedLogo: resolve(__dirname, 'extracted_logo.html'),
      },
    },
  },
});
