import { generateArt } from "../assets/art.ts";

const dir = process.argv[2] ?? "assets";
const { frames, sheet } = generateArt(dir);
console.log(`production sprite sheet written to ${dir}: ${frames} frames, ${sheet[0]}x${sheet[1]}`);
