const { sanitize } = require('./backend/node/dist/lib/logger.js');

const err = new Error("This is an error");
err.stack = "Error: This is an error\n    at Object.<anonymous> (/app/test.js:1:1)";

console.log(sanitize(err));
