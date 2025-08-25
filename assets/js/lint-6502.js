// lint-6502.js
const fs = require("fs");

const src = fs.readFileSync("6502.js", "utf8");
const lines = src.split("\n");

const badPatterns = [
  { regex: /checkReadOffset\(\s*\(\s*CPUregisters\.PC\s*\+\s*(1|2)\s*\)\s*&\s*0xFF(?!F)\s*\)/, name: "PC masked to 0xFF" },
  { regex: /checkReadOffset\(\s*\(\s*CPUregisters\.PC\s*\+\s*(1|2)\s*\)\s*&\s*255\s*\)/, name: "PC masked to 255" },
  { regex: /checkReadOffset\(CPUregisters\.PC\s*\+\s*(1|2)\s*&\s*0xFF(?!F)\)/, name: "PC+N & 0xFF precedence" },
  { regex: /\bconst\s+hi\s*=\s*checkReadOffset\(\s*CPUregisters\.PC\s*\+\s*1\s*\)/, name: "hi fetched from PC+1" },
  { regex: /checkReadOffset\(\(\s*CPUregisters\.PC\s*\+\s*(1|2)\s*\)\s*;/, name: "dangling operand call" }
];

let errors = 0;

lines.forEach((line, i) => {
  for (const p of badPatterns) {
    if (p.regex.test(line)) {
      console.error(`Line ${i + 1}: ${p.name} -> ${line.trim()}`);
      errors++;
    }
  }
});

if (errors > 0) {
  console.error(`\nLint failed with ${errors} issue(s).`);
  process.exit(1);
} else {
  console.log("✓ No operand-fetch issues found.");
}
