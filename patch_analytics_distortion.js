const fs = require('fs');
let content = fs.readFileSync('frontend/src/components/Analytics.jsx', 'utf8');

// Replace the SVG elements that distort with HTML elements inside the wrapper
// Specifically: the zero line and the circle dots.

const oldLine = `{/* Zero Line */}
          <line
            x1="0" y1={zeroY} x2="100" y2={zeroY}
            stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" strokeDasharray="2,2"
          />`;

content = content.replace(oldLine, "");

const oldCircles = `{/* Dots at current endpoints */}
          {points.length > 0 && (
             <>
               <circle cx={points[points.length-1].xPct * 100} cy={100 - ((points[points.length-1].longPnl - viewMin) / viewRange) * 100} r="1.5" fill="var(--color-green-theme, #00e5a0)" />
               <circle cx={points[points.length-1].xPct * 100} cy={100 - ((points[points.length-1].shortPnl - viewMin) / viewRange) * 100} r="1.5" fill="var(--color-red-theme, #ff4466)" />
             </>
          )}`;

content = content.replace(oldCircles, "");

const oldSvgEnd = `</svg>`;

const newOverlays = `</svg>

        {/* Un-distorted Zero Line Overlay */}
        <div
          className="absolute left-0 right-0 border-t border-dashed border-border/40 pointer-events-none"
          style={{ top: \`\${zeroY}%\` }}
        />

        {/* Un-distorted Endpoint Dots */}
        {points.length > 0 && (
          <>
            <div
              className="absolute w-2 h-2 rounded-full bg-green transform -translate-x-1/2 -translate-y-1/2 shadow-[0_0_8px_rgba(0,229,160,0.5)]"
              style={{
                left: \`\${points[points.length-1].xPct * 100}%\`,
                top: \`\${100 - ((points[points.length-1].longPnl - viewMin) / viewRange) * 100}%\`
              }}
            />
            <div
              className="absolute w-2 h-2 rounded-full bg-red transform -translate-x-1/2 -translate-y-1/2 shadow-[0_0_8px_rgba(255,68,102,0.5)]"
              style={{
                left: \`\${points[points.length-1].xPct * 100}%\`,
                top: \`\${100 - ((points[points.length-1].shortPnl - viewMin) / viewRange) * 100}%\`
              }}
            />
          </>
        )}`;

content = content.replace(oldSvgEnd, newOverlays);

fs.writeFileSync('frontend/src/components/Analytics.jsx', content);
