const fs = require('fs');
let content = fs.readFileSync('backend/node/src/engine/exit_estimation.service.ts', 'utf8');

const regex = /state: 'diverging',\n\s*proximity: 15,/g;
const replacement = `state: 'diverging',
            proximity: 0,`;
content = content.replace(regex, replacement);

fs.writeFileSync('backend/node/src/engine/exit_estimation.service.ts', content);
