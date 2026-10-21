import type { Cache, CacheEntry } from "./moodle/client";

/** Quanto tempo um dado vencido ainda pode ser mostrado enquanto a versão nova é buscada. */
const MAX_STALE_MS = 7 * 86400 * 1000;

/**
 * Cache com validade no localStorage, com uma cópia em memória (trocar de página não relê nem
 * reprocessa o JSON). Entradas vencidas continuam disponíveis por até 7 dias para serem mostradas
 * na hora enquanto o app busca a versão nova (o cliente decide isso).
 *
 * O localStorage tem limite (~5 MB). Quando enche, o cache apaga o que está vencido e, se ainda
 * faltar espaço, as entradas mais antigas — em vez de parar de gravar sem avisar.
 * Falhas de storage (modo privado, bloqueio) são ignoradas: aí só a memória é usada.
 */
export class LocalStorageCache implements Cache {
  #mem = new Map<string, CacheEntry>();

  constructor(private prefix = "ava-cache:") {
    this.prune();
  }

  get(key: string): CacheEntry | undefined {
    const m = this.#mem.get(key);
    if (m) return m;
    try {
      const raw = localStorage.getItem(this.prefix + key);
      if (!raw) return undefined;
      const e = JSON.parse(raw) as CacheEntry;
      if (typeof e?.exp !== "number" || Date.now() > e.exp + MAX_STALE_MS) {
        localStorage.removeItem(this.prefix + key);
        return undefined;
      }
      this.#mem.set(key, e);
      return e;
    } catch {
      return undefined;
    }
  }

  set(key: string, v: unknown, ttl: number) {
    const e: CacheEntry = { v, exp: Date.now() + ttl * 1000 };
    this.#mem.set(key, e);
    const raw = JSON.stringify(e);
    if (this.#write(key, raw)) return;
    // Cheio: tira o que já venceu e tenta de novo; depois, as entradas mais antigas.
    this.prune(true);
    if (this.#write(key, raw)) return;
    for (const k of this.#keysByAge()) {
      try {
        localStorage.removeItem(k);
      } catch {}
      if (this.#write(key, raw)) return;
    }
    // Não coube nem sozinho: fica só na memória até fechar a aba.
  }

  clear() {
    this.#mem.clear();
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(this.prefix)) localStorage.removeItem(k);
    } catch {}
  }

  /** Remove entradas inválidas e velhas demais (ou todas as vencidas, com `aggressive`). */
  prune(aggressive = false) {
    try {
      const now = Date.now();
      for (const k of Object.keys(localStorage)) {
        if (!k.startsWith(this.prefix)) continue;
        try {
          const e = JSON.parse(localStorage.getItem(k) ?? "") as CacheEntry;
          const limit = aggressive ? e.exp : e.exp + MAX_STALE_MS;
          if (typeof e?.exp !== "number" || now > limit) localStorage.removeItem(k);
        } catch {
          localStorage.removeItem(k);
        }
      }
    } catch {}
  }

  #write(key: string, raw: string): boolean {
    try {
      localStorage.setItem(this.prefix + key, raw);
      return true;
    } catch {
      return false;
    }
  }

  /** Chaves deste cache, da que vence primeiro para a última. */
  #keysByAge(): string[] {
    try {
      return Object.keys(localStorage)
        .filter((k) => k.startsWith(this.prefix))
        .map((k) => {
          try {
            return { k, exp: (JSON.parse(localStorage.getItem(k) ?? "") as CacheEntry).exp ?? 0 };
          } catch {
            return { k, exp: 0 };
          }
        })
        .sort((a, b) => a.exp - b.exp)
        .map((x) => x.k);
    } catch {
      return [];
    }
  }
}

const TOKEN_KEY = "ava-token";

export function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}
