import fs from "node:fs";
import path from "node:path";
import UglifyJS from "uglify-js";

const [inputPath, inputMapPath, outputPath, outputMapPath] = process.argv.slice(2);

if (!inputPath || !inputMapPath || !outputPath || !outputMapPath) {
  console.error(
    "Usage: node scripts/minify-release-js.mjs <input.js> <input.js.map> <output.js> <output.js.map>"
  );
  process.exit(1);
}

const input = fs.readFileSync(inputPath, "utf8");
const inputMap = fs.readFileSync(inputMapPath, "utf8");
const inputName = path.basename(inputPath);
const outputName = path.basename(outputPath);
const result = UglifyJS.minify(
  { [inputName]: input },
  {
    compress: {
      passes: 2
    },
    mangle: true,
    output: {
      ascii_only: true
    },
    sourceMap: {
      content: inputMap,
      filename: outputName,
      includeSources: true
    }
  }
);

if (result.error) {
  throw result.error;
}
if (!result.code || !result.map) {
  throw new Error("UglifyJS did not produce release JavaScript and a source map");
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(path.dirname(outputMapPath), { recursive: true });
fs.writeFileSync(outputPath, `${result.code}\n`);
fs.writeFileSync(outputMapPath, `${result.map}\n`);
