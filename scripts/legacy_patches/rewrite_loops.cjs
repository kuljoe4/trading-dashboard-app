const fs = require('fs');
const file = 'backend/node/src/engine/execution.service.ts';
let code = fs.readFileSync(file, 'utf8');

const outerLoopStart = `          for (const tf of uniqueTimeframes) {
            const tfCandles = this.klineStore.getRawCandles(opp.symbol, tf);
            const tfDurationMs = this.getTimeframeMs(tf);

            if (tfCandles.length > 0) {
              const currentCandleStart = tfCandles[tfCandles.length - 1].time;

              for (let i = 0; i < closedTrades.length; i++) {
                const t = closedTrades[i];
                if (t.symbol === opp.symbol) {
                  // If anti_whipsaw_allow_knife is active, candidate is knife, and closed trade was a knife trade, bypass gating
                  if (symbolConfig.anti_whipsaw_allow_knife && isCandidateKnife && t.is_knife) {
                    const bypassMsg = \`[Anti-Whipsaw Bypass] \${opp.symbol}: Knife re-entry allowed for closed knife trade.\`;
                    this.logger.log(bypassMsg);
                    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: bypassMsg, level: 'info' });
                    this.broadcastService.broadcast('alert', {
                      level: 'info',
                      title: 'Anti-Whipsaw Knife Bypass',
                      message: bypassMsg,
                      symbol: opp.symbol
                    });
                    continue;
                  }



                  const candleDelay = symbolConfig.anti_whipsaw_candle_delay ?? 1;
                  const tfDelayMin = symbolConfig.anti_whipsaw_tf_delay_min ?? 0;
                  const effectiveDelayMs = Math.max(candleDelay * tfDurationMs, tfDelayMin * 60 * 1000);

                  if (effectiveDelayMs > 0) {
                    if (t.entry_ts) {
                      const entryTsMs = this.toTimestampMs(t.entry_ts);
                      const nowMs = Date.now();
                      if (entryTsMs > 0 && (entryTsMs >= currentCandleStart || nowMs < entryTsMs + effectiveDelayMs)) {
                        sameCandleGated = true;
                        gatedTimeframe = tf;
                        gateReason = \`entered during the current \${tf} candle period\`;
                        break;
                      }
                    }

                    if (t.exit_ts) {
                      const exitTsMs = this.toTimestampMs(t.exit_ts);
                      const nowMs = Date.now();
                      const validExitTsMs = exitTsMs > nowMs ? nowMs : exitTsMs;
                      if (validExitTsMs > 0 && (validExitTsMs >= currentCandleStart || nowMs < validExitTsMs + effectiveDelayMs)) {
                        sameCandleGated = true;
                        gatedTimeframe = tf;
                        const cooldownMins = Math.ceil(effectiveDelayMs / 60000);
                        gateReason = validExitTsMs >= currentCandleStart
                          ? \`exited during the active \${tf} candle\`
                          : \`exited within the \${cooldownMins}m timeframe cooldown window\`;
                        break;
                      }
                    }
                  }
                }
              }

              if (sameCandleGated) break;
            }
          }`;

const optimizedLoops = `          // Pre-filter trades for this specific symbol once to avoid O(N*M) nested iterations
          const symbolClosedTrades = [];
          for (let i = 0; i < closedTrades.length; i++) {
            if (closedTrades[i].symbol === opp.symbol) {
              symbolClosedTrades.push(closedTrades[i]);
            }
          }

          for (const tf of uniqueTimeframes) {
            const tfCandles = this.klineStore.getRawCandles(opp.symbol, tf);
            const tfDurationMs = this.getTimeframeMs(tf);

            if (tfCandles.length > 0) {
              const currentCandleStart = tfCandles[tfCandles.length - 1].time;

              const candleDelay = symbolConfig.anti_whipsaw_candle_delay ?? 1;
              const tfDelayMin = symbolConfig.anti_whipsaw_tf_delay_min ?? 0;
              const effectiveDelayMs = Math.max(candleDelay * tfDurationMs, tfDelayMin * 60 * 1000);

              if (effectiveDelayMs > 0) {
                const nowMs = Date.now();
                const cooldownMins = Math.ceil(effectiveDelayMs / 60000);

                for (let i = 0; i < symbolClosedTrades.length; i++) {
                  const t = symbolClosedTrades[i];

                  // If anti_whipsaw_allow_knife is active, candidate is knife, and closed trade was a knife trade, bypass gating
                  if (symbolConfig.anti_whipsaw_allow_knife && isCandidateKnife && t.is_knife) {
                    const bypassMsg = \`[Anti-Whipsaw Bypass] \${opp.symbol}: Knife re-entry allowed for closed knife trade.\`;
                    this.logger.log(bypassMsg);
                    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: bypassMsg, level: 'info' });
                    this.broadcastService.broadcast('alert', {
                      level: 'info',
                      title: 'Anti-Whipsaw Knife Bypass',
                      message: bypassMsg,
                      symbol: opp.symbol
                    });
                    continue;
                  }

                  if (t.entry_ts) {
                    const entryTsMs = this.toTimestampMs(t.entry_ts);
                    if (entryTsMs > 0 && (entryTsMs >= currentCandleStart || nowMs < entryTsMs + effectiveDelayMs)) {
                      sameCandleGated = true;
                      gatedTimeframe = tf;
                      gateReason = \`entered during the current \${tf} candle period\`;
                      break;
                    }
                  }

                  if (t.exit_ts) {
                    const exitTsMs = this.toTimestampMs(t.exit_ts);
                    const validExitTsMs = exitTsMs > nowMs ? nowMs : exitTsMs;
                    if (validExitTsMs > 0 && (validExitTsMs >= currentCandleStart || nowMs < validExitTsMs + effectiveDelayMs)) {
                      sameCandleGated = true;
                      gatedTimeframe = tf;
                      gateReason = validExitTsMs >= currentCandleStart
                        ? \`exited during the active \${tf} candle\`
                        : \`exited within the \${cooldownMins}m timeframe cooldown window\`;
                      break;
                    }
                  }
                }
              }
              if (sameCandleGated) break;
            }
          }`;

code = code.replace(outerLoopStart, optimizedLoops);
fs.writeFileSync(file, code);
