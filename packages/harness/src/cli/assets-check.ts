import { checkAssets, formatReport } from "../assets/check.ts";
const dir = process.argv[2] ?? "assets";
const report = checkAssets(dir);
console.log(formatReport(report));
process.exit(report.ok ? 0 : 1);
