import { defineConfig } from 'vite';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

// Plugin: stamp public/version.json with build timestamp on every deploy
function versionPlugin() {
  return {
    name: 'version-stamp',
    buildStart() {
      const version = Date.now().toString();
      writeFileSync(resolve(__dirname, 'public/version.json'), JSON.stringify({ v: version }));
      console.log(`[version-stamp] Build version: ${version}`);
    }
  };
}

export default defineConfig({
  plugins: [versionPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        menu: resolve(__dirname, 'menu.html'),
        driverOrder: resolve(__dirname, 'driver-order.html'),
        adminDashboard: resolve(__dirname, 'admin-dashboard.html'),
        offline: resolve(__dirname, 'offline.html'),
        checkout: resolve(__dirname, 'checkout.html'),
        orderConfirmation: resolve(__dirname, 'order-confirmation.html'),
        terms: resolve(__dirname, 'terms.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        refunds: resolve(__dirname, 'refunds.html'),
        account: resolve(__dirname, 'account.html'),
      },
    },
  },
});
