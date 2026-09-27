import { checkOrigin } from "./backend/node/src/lib/origin.js";
console.log(checkOrigin("https://backend-staging2-7ec5.up.railway.app", ["https://*.up.railway.app"]));
