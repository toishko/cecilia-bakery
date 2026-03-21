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
        staffLogin: resolve(__dirname, 'staff-login.html'),
        resetPassword: resolve(__dirname, 'reset-password.html'),
        updatePassword: resolve(__dirname, 'update-password.html'),
        customerDashboard: resolve(__dirname, 'customer-dashboard.html'),
        adminDashboard: resolve(__dirname, 'admin-dashboard.html'),
        partnerDashboard: resolve(__dirname, 'partner-dashboard.html'),
        staffDashboard: resolve(__dirname, 'staff-dashboard.html'),
        driverDashboard: resolve(__dirname, 'driver-dashboard.html'),
        extractedLogo: resolve(__dirname, 'extracted_logo.html'),
      },
    },
  },
});
