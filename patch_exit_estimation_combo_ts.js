const fs = require('fs');
let content = fs.readFileSync('backend/node/src/engine/exit_estimation.service.ts', 'utf8');

const regex1 = /const getTopPriority = \(ests\) => \{/;
const replacement1 = `const getTopPriority = (ests: ExitEstimation[]) => {`;
content = content.replace(regex1, replacement1);

const regex2 = /const fired = ests\.find\(e => e\.state === 'fired'\);/g;
const replacement2 = `const fired = ests.find((e: ExitEstimation) => e.state === 'fired');`;
content = content.replace(regex2, replacement2);

const regex3 = /const ready = ests\.find\(e => e\.state === 'ready'\);/g;
const replacement3 = `const ready = ests.find((e: ExitEstimation) => e.state === 'ready');`;
content = content.replace(regex3, replacement3);

const regex4 = /state: 'fired',/g;
const replacement4 = `state: 'fired' as const,`;
content = content.replace(regex4, replacement4);

const regex5 = /state: 'ready',/g;
const replacement5 = `state: 'ready' as const,`;
content = content.replace(regex5, replacement5);

const regex6 = /let selOpt = optEsts\.length > 0 \? optEsts\[0\] : null;\n\s*for \(let i = 1; i < optEsts\.length; i\+\+\) \{\n\s*if \(optEsts\[i\]\.proximity > selOpt\.proximity\) \{\n\s*selOpt = optEsts\[i\];\n\s*\}\n\s*\}/;
const replacement6 = `let selOpt = optEsts.length > 0 ? optEsts[0] : null;
        if (selOpt) {
          for (let i = 1; i < optEsts.length; i++) {
            if (optEsts[i].proximity > selOpt.proximity) {
              selOpt = optEsts[i];
            }
          }
        }`;
content = content.replace(regex6, replacement6);

fs.writeFileSync('backend/node/src/engine/exit_estimation.service.ts', content);
