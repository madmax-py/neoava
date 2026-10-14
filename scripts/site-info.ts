// Passo 2: descobre quais funções este token pode chamar e salva em docs/funcoes_disponiveis.json.
import { writeFileSync } from "node:fs";
import { READ_ONLY_FUNCTIONS } from "../src/moodle/client";
import { handleError, makeClient } from "./node-client";

const { api } = makeClient();
try {
  const info = await api.siteInfo({ refresh: true });
  const names = info.functions.map((f) => f.name).sort();
  writeFileSync(
    "docs/funcoes_disponiveis.json",
    JSON.stringify({ sitename: info.sitename, release: info.release, geradoEm: new Date().toISOString(), functions: names }, null, 2) + "\n",
  );
  console.log(`${info.sitename} — ${info.release ?? ""}`);
  console.log(`Usuário: ${info.fullname} (id ${info.userid})`);
  console.log(`${names.length} funções liberadas → docs/funcoes_disponiveis.json\n`);
  for (const f of READ_ONLY_FUNCTIONS) console.log(`${names.includes(f) ? "✔" : "✘"} ${f}`);
} catch (e) {
  handleError(e);
}
