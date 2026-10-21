// Configuração do cliente para scripts Node: lê .env e usa cache em arquivo (.cache/, fora do git).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { MoodleClient, MoodleError, type Cache } from "../src/moodle/client";
import { createApi } from "../src/moodle/api";

if (existsSync(".env")) process.loadEnvFile(".env");

class FileCache implements Cache {
  #path = ".cache/moodle.json";
  #data: Record<string, { v: unknown; exp: number }> = {};
  constructor() {
    try {
      this.#data = JSON.parse(readFileSync(this.#path, "utf8"));
    } catch {}
  }
  get(key: string) {
    return this.#data[key]; // o cliente ignora entradas vencidas (sem staleWhileRevalidate)
  }
  set(key: string, v: unknown, ttl: number) {
    this.#data[key] = { v, exp: Date.now() + ttl * 1000 };
    mkdirSync(".cache", { recursive: true });
    writeFileSync(this.#path, JSON.stringify(this.#data));
  }
}

export function makeClient() {
  const token = process.env.MOODLE_TOKEN?.trim();
  if (!token) {
    console.error("MOODLE_TOKEN não definido. Copie .env.example para .env e preencha o token.");
    process.exit(1);
  }
  const client = new MoodleClient({
    baseUrl: process.env.MOODLE_URL || "https://avagrad.unievangelica.edu.br",
    token,
    cache: new FileCache(),
  });
  return { client, api: createApi(client) };
}

export const refresh = process.argv.includes("--refresh");

export function handleError(e: unknown): never {
  if (e instanceof MoodleError && e.needsNewToken) {
    console.error(`\nToken inválido, expirado ou sem permissão para ${e.wsfunction} (${e.errorcode}).`);
    console.error("Gere um novo token em /login/token.php e atualize MOODLE_TOKEN no .env.");
  } else if (e instanceof MoodleError) {
    console.error(`\nErro do Moodle em ${e.wsfunction} [${e.errorcode}]: ${e.message}`);
  } else {
    console.error(e);
  }
  process.exit(1);
}
