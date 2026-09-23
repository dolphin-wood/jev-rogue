import { generatePlaceholders } from "../assets/placeholder.ts";
const dir = process.argv[2] ?? "assets";
const { frames, sheet } = generatePlaceholders(dir);
console.log(`placeholder sheet written to ${dir}: ${frames} frames, ${sheet[0]}x${sheet[1]}`);
