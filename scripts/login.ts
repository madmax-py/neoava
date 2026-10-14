// Pede matrícula e senha (oculta), troca por um token no AVA e grava só o token no .env.
// A senha nunca é gravada nem logada.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { maskToken, requestToken } from "../src/moodle/client";

if (existsSync(".env")) process.loadEnvFile(".env");
const baseUrl = process.env.MOODLE_URL || "https://avagrad.unievangelica.edu.br";

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Não ecoa o que é digitado.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.startsWith(question)) process.stdout.write(question);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    }),
  );
}

const username = (await ask("Matrícula: ")).trim();
let password = await ask("Senha: ", true);
try {
  const token = await requestToken(baseUrl, username, password);
  password = "";
  let env = existsSync(".env") ? readFileSync(".env", "utf8") : readFileSync(".env.example", "utf8");
  env = /^MOODLE_TOKEN=.*$/m.test(env) ? env.replace(/^MOODLE_TOKEN=.*$/m, `MOODLE_TOKEN=${token}`) : `${env.trimEnd()}\nMOODLE_TOKEN=${token}\n`;
  writeFileSync(".env", env, { mode: 0o600 });
  console.log(`Token ${maskToken(token)} salvo em .env.`);
} catch (e) {
  password = "";
  console.error((e as Error).message);
  process.exit(1);
}
