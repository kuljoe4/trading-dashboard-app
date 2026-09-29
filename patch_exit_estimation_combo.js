const fs = require('fs');
let content = fs.readFileSync('backend/node/src/engine/exit_estimation.service.ts', 'utf8');

const targetRegex = /\/\/ Any fired signal takes top priority[\s\S]*?(?=if \(logic === 'any'\) \{)/;
const replacement = `// Get the fired/ready logic inside each branch so ALL and COMBO can act correctly.
    const allReadyOrFired = estimationsList.every(e => e.state === 'fired' || e.state === 'ready');
    const firedEsts = estimationsList.filter(e => e.state === 'fired');
    const readyEsts = estimationsList.filter(e => e.state === 'ready');

    const getTopPriority = (ests) => {
      const fired = ests.find(e => e.state === 'fired');
      if (fired) return {
        selectedSignalKey: fired.signalType,
        state: 'fired',
        proximity: 100,
        etaCandles: 0,
        etaSeconds: 0,
        confidence: 100,
        estimatedExitPrice: fired.estimatedExitPrice,
        estimatedPnl: fired.estimatedPnl,
        estimatedR: fired.estimatedR,
        description: \`Exit fired by \${fired.signalType}\`,
        signalEstimations
      };
      const ready = ests.find(e => e.state === 'ready');
      if (ready) return {
        selectedSignalKey: ready.signalType,
        state: 'ready',
        proximity: 99,
        etaCandles: 0,
        etaSeconds: 0,
        confidence: ready.confidence,
        estimatedExitPrice: ready.estimatedExitPrice,
        estimatedPnl: ready.estimatedPnl,
        estimatedR: ready.estimatedR,
        description: \`Exit ready via \${ready.signalType}\`,
        signalEstimations
      };
      return null;
    };

    `;

content = content.replace(targetRegex, replacement);

const anyRegex = /if \(logic === 'any'\) \{[\s\S]*?\} else if \(logic === 'all'\) \{/;
const anyReplacement = `if (logic === 'any') {
      const top = getTopPriority(estimationsList);
      if (top) return top;

      // ANY logic: Select actionable signal with highest proximity
      // BOLT OPTIMIZATION: Single-pass O(N) loop replaces array mutation sort()
      let sel = estimationsList[0];
      for (let i = 1; i < estimationsList.length; i++) {
        if (estimationsList[i].proximity > sel.proximity) {
          sel = estimationsList[i];
        }
      }
      return {
        selectedSignalKey: sel.signalType,
        state: sel.state,
        proximity: sel.proximity,
        etaCandles: sel.etaCandles,
        etaSeconds: sel.etaSeconds,
        confidence: sel.confidence,
        estimatedExitPrice: sel.estimatedExitPrice,
        estimatedPnl: sel.estimatedPnl,
        estimatedR: sel.estimatedR,
        description: sel.description,
        signalEstimations
      };
    } else if (logic === 'all') {`;

content = content.replace(anyRegex, anyReplacement);

const allRegex = /\/\/ ALL logic: Bottlenecked by signal with lowest proximity[\s\S]*?\} else if \(logic === 'combo'\) \{/;
const allReplacement = `// ALL logic: Bottlenecked by signal with lowest proximity
      if (allReadyOrFired) {
         const top = getTopPriority(estimationsList);
         if (top) return top;
      }
      if (estimationsList.length > 0) {
        let sel = estimationsList[0];
        for (let i = 1; i < estimationsList.length; i++) {
          if (estimationsList[i].proximity < sel.proximity) {
            sel = estimationsList[i];
          }
        }
        return {
          selectedSignalKey: sel.signalType,
          state: sel.state,
          proximity: sel.proximity,
          etaCandles: sel.etaCandles,
          etaSeconds: sel.etaSeconds,
          confidence: sel.confidence,
          estimatedExitPrice: sel.estimatedExitPrice,
          estimatedPnl: sel.estimatedPnl,
          estimatedR: sel.estimatedR,
          description: \`Bottlenecked by \${sel.signalType}\`,
          signalEstimations
        };
      }
    } else if (logic === 'combo') {`;

content = content.replace(allRegex, allReplacement);

const comboRegex = /\/\/ COMBO logic: Required bottleneck combined with optional max[\s\S]*?\/\/ Fallback: Pick highest proximity estimation/;
const comboReplacement = `// COMBO logic: Required bottleneck combined with optional max
      const reqKeys = requiredExitSigs.length > 0 ? requiredExitSigs : [exitSignals[0]];
      const optKeys = exitSignals.filter(k => !reqKeys.includes(k));
      const reqEsts = estimationsList.filter(e => reqKeys.includes(e.signalType));
      const optEsts = estimationsList.filter(e => optKeys.includes(e.signalType));

      const reqAllReadyOrFired = reqEsts.every(e => e.state === 'fired' || e.state === 'ready');
      const optAnyReadyOrFired = optEsts.some(e => e.state === 'fired' || e.state === 'ready') || optEsts.length === 0;

      if (reqAllReadyOrFired && optAnyReadyOrFired) {
          const reqTop = getTopPriority(reqEsts);
          if (reqTop) return reqTop;
      }

      if (reqEsts.length > 0) {
        let selReq = reqEsts[0];
        for (let i = 1; i < reqEsts.length; i++) {
          if (reqEsts[i].proximity < selReq.proximity) {
            selReq = reqEsts[i];
          }
        }

        let selOpt = optEsts.length > 0 ? optEsts[0] : null;
        for (let i = 1; i < optEsts.length; i++) {
          if (optEsts[i].proximity > selOpt.proximity) {
            selOpt = optEsts[i];
          }
        }

        const finalProximity = selOpt ? Math.min(selReq.proximity, selOpt.proximity) : selReq.proximity;
        const sel = (selOpt && selOpt.proximity < selReq.proximity) ? selOpt : selReq;

        return {
          selectedSignalKey: sel.signalType,
          state: sel.state,
          proximity: finalProximity,
          etaCandles: sel.etaCandles,
          etaSeconds: sel.etaSeconds,
          confidence: sel.confidence,
          estimatedExitPrice: sel.estimatedExitPrice,
          estimatedPnl: sel.estimatedPnl,
          estimatedR: sel.estimatedR,
          description: \`Required exit \${selReq.signalType}\${selOpt ? \`, Optional \${selOpt.signalType}\` : ''}\`,
          signalEstimations
        };
      }
    }

    // Fallback: Pick highest proximity estimation`;

content = content.replace(comboRegex, comboReplacement);

fs.writeFileSync('backend/node/src/engine/exit_estimation.service.ts', content);
