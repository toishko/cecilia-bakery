// Read driver-order.js and simulate loadInventoryData
const fs = require('fs');
const code = fs.readFileSync('driver-order.js', 'utf-8');
console.log('Got code, length: ', code.length);
