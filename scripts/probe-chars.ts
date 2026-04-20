import { readFileSync } from "fs";
import { DocumentExtractionService } from "../src/services/ai/DocumentExtractionService";

async function main() {
  const text = await new DocumentExtractionService().extractText(
    readFileSync(process.argv[2]),
  );
  const target = process.argv[3] ?? "Lis";
  const idx = text.indexOf(target);
  console.log(`Found "${target}" at idx=${idx}`);
  for (let i = idx; i < idx + 20; i++) {
    console.log(i, text.charCodeAt(i), JSON.stringify(text[i]));
  }
}
main();
