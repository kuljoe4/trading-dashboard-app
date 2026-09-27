import { checkOrigin } from "./backend/node/src/lib/origin.js";
console.log(checkOrigin("https://frontend-staging2-7ec5.up.railway.app", ["*"]));
