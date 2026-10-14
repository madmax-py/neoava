// Diagnóstico (somente leitura): mostra quais campos o AVA devolve no quadro de notas de uma disciplina.
// Uso: npm run inspecionar -- <courseid>   (sem id: lista as disciplinas)
// Salva a resposta bruta em .cache/ (fora do git) — contém suas notas, não compartilhe.
import { mkdirSync, writeFileSync } from "node:fs";
import { handleError, makeClient } from "./node-client";

const { client, api } = makeClient();
try {
  const info = await api.siteInfo({ refresh: true });
  const courseid = Number(process.argv[2]);
  if (!courseid) {
    for (const c of await api.courses(info.userid)) console.log(`${String(c.id).padStart(6)}  ${c.fullname}`);
    console.log("\nRode de novo com o id: npm run inspecionar -- <id>");
    process.exit(0);
  }

  const raw = await client.call<{ usergrades: { gradeitems: Record<string, unknown>[] }[] }>(
    "gradereport_user_get_grade_items",
    { courseid, userid: info.userid },
    { refresh: true },
  );
  const items = raw.usergrades[0]?.gradeitems ?? [];
  const keys = [...new Set(items.flatMap((i) => Object.keys(i)))].sort();
  console.log(`\n${items.length} itens. Campos presentes: ${keys.join(", ")}\n`);
  const cols = ["id", "itemtype", "itemmodule", "iteminstance", "categoryid", "itemname", "graderaw", "gradeformatted", "grademin", "grademax", "weightraw", "status", "gradeishidden"];
  console.table(items.map((i) => Object.fromEntries(cols.map((k) => [k, typeof i[k] === "string" ? String(i[k]).slice(0, 40) : i[k]]))));

  let table: unknown = null;
  if (info.functions.some((f) => f.name === "gradereport_user_get_grades_table")) {
    table = await client.call("gradereport_user_get_grades_table", { courseid, userid: info.userid }, { refresh: true });
    console.log("gradereport_user_get_grades_table: disponível (salvo no arquivo)");
  } else console.log("gradereport_user_get_grades_table: não liberada para este token");

  mkdirSync(".cache", { recursive: true });
  const out = `.cache/inspecao-${courseid}.json`;
  writeFileSync(out, JSON.stringify({ items, table }, null, 2));
  console.log(`\nResposta bruta salva em ${out}`);
} catch (e) {
  handleError(e);
}
