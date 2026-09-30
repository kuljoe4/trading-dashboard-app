const fs = require('fs');
let content = fs.readFileSync('frontend/src/lib/formatters.js', 'utf8');

content = content.replace(
  /if \(isEventBased && !isFired\) \{\s*return maxVal; \/\/ State: STALE \/ PASSED\s*\}/g,
  `if (isEventBased && !isFired) {
            return 0; // State: STALE / PASSED
          }`
);
content = content.replace(
  /if \(isEventBased && !isFired\) \{\s*return 99; \/\/ State: READY\s*\}/g,
  `if (isEventBased && !isFired) {
            return 0; // State: STALE / PASSED
          }`
);

fs.writeFileSync('frontend/src/lib/formatters.js', content);
