import { generateAudio } from "../assets/audio.ts";

const dir = process.argv[2] ?? "assets";
const { files, digest } = generateAudio(dir);
console.log(`sfx written to ${dir}/sfx: ${files} files, digest ${digest}`);
