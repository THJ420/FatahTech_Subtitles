import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dist = new URL("./", import.meta.resolve("@huggingface/transformers"));
const { version } = JSON.parse(
  await readFile(new URL("../package.json", dist), "utf8"),
);
const destination = new URL(
  `../public/onnxruntime/${version}/`,
  import.meta.url,
);
await mkdir(destination, { recursive: true });

for (const file of [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
]) {
  await copyFile(new URL(file, dist), new URL(file, destination));
}

console.info(
  `Speech runtime ${version} prepared at ${fileURLToPath(destination)}`,
);
