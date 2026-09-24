const fs = require('fs');
const filePath = 'backend/node/src/engine/orderManager.ts';
let content = fs.readFileSync(filePath, 'utf8');

const searchBlock = `            // To ensure integrity across missed UDS slices, we calculate absolute gross profit
            // from entry to exit on the total position size, then subtract all realized costs.
            this.logger.log(\`[PnL Integrity] Finalizing Live trade \${symbol} via Absolute PnL path: AbsoluteGross=\${totalGrossPnl.toFixed(4)}, Fees=\${trade.realized_fee}, Funding=\${trade.funding_fee}, FinalNet=\${absoluteNetPnl} (Qty=\${initialQty}, Exit=\${exitPrice}, Reason=\${exitReason})\`);
            trade.pnl = absoluteNetPnl;`;

const replaceBlock = `            // To ensure integrity across missed UDS slices, we calculate absolute gross profit
            // from entry to exit on the total position size, then subtract all realized costs.
            // FIX: If the trade quantity has already been driven to 0 (meaning all fills have been processed via UDS),
            // the accumulated PnL is accurate and represents the exact multi-slice execution. Overwriting it with absoluteNetPnl (which uses the single terminal exitPrice) corrupts the PnL.
            if (trade.qty === 0 && exitReason === EXIT_REASONS.EXCHANGE_SYNC) {
               this.logger.log(\`[PnL Integrity] Finalizing Live trade \${symbol} via Preserved PnL path (Terminal Quantity is 0, full UDS processed): FinalNet=\${trade.pnl} (Qty=\${initialQty}, Exit=\${exitPrice}, Reason=\${exitReason})\`);
            } else {
               this.logger.log(\`[PnL Integrity] Finalizing Live trade \${symbol} via Absolute PnL path: AbsoluteGross=\${totalGrossPnl.toFixed(4)}, Fees=\${trade.realized_fee}, Funding=\${trade.funding_fee}, FinalNet=\${absoluteNetPnl} (Qty=\${initialQty}, Exit=\${exitPrice}, Reason=\${exitReason})\`);
               trade.pnl = absoluteNetPnl;
            }`;

content = content.replace(searchBlock, replaceBlock);
fs.writeFileSync(filePath, content, 'utf8');
