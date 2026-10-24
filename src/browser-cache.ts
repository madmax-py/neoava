import type { Cache, CacheEntry } from "./moodle/client";

/** Quanto tempo um dado vencido ainda pode ser mostrado enquanto a versão nova é buscada. */
const MAX_STALE_MS = 7 * 86400 * 1000;

/**
 * Cache com validade no localStorage (ou no sessionStorage, sem "Lembrar neste computador"), com uma cópia em memória (trocar de página não relê nem
 * reprocessa o JSON). Entradas vencidas continuam disponíveis por até 7 dias para serem mostradas
 * na hora enquanto o app busca a versão nova (o cliente decide isso).
 *
 * O localStorage tem limite (~5 MB). Quando enche, o cache apaga o que está vencido e, se ainda
 * faltar espaço, as entradas mais antigas — em vez de parar de gravar sem avisar.
 * Falhas de storage (modo privado, bloqueio) são ignoradas: aí só a memória é usada.
 */
export class BrowserCache implements Cache {
  #mem = new Map<string, CacheEntry>();

  /**
   * `persistent` = false: grava no sessionStorage (some ao fechar a aba), para computadores
   * compartilhados. Pode mudar depois do login (opção "Lembrar neste computador").
   */
  constructor(
    private prefix = "ava-cache:",
    public persistent = true,
  ) {
    this.prune();
  }

  get #store(): Storage {
    return this.persistent ? localStorage : sessionStorage;
  }

  get(key: string): CacheEntry | undefined {
    const m = this.#mem.get(key);
    if (m) return m;
    try {
      const raw = this.#store.getItem(this.prefix + key);
      if (!raw) return undefined;
      const e = JSON.parse(raw) as CacheEntry;
      if (typeof e?.exp !== "number" || Date.now() > e.exp + MAX_STALE_MS) {
        this.#store.removeItem(this.prefix + key);
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
        this.#store.removeItem(k);
      } catch {}
      if (this.#write(key, raw)) return;
    }
    // Não coube nem sozinho: fica só na memória até fechar a aba.
  }

  /** Apaga a memória e as duas áreas (local e de sessão), para não sobrar nada ao trocar de modo. */
  clear() {
    this.#mem.clear();
    for (const store of [() => localStorage, () => sessionStorage]) {
      try {
        const s = store();
        for (const k of Object.keys(s)) if (k.startsWith(this.prefix)) s.removeItem(k);
      } catch {}
    }
  }

  /** Marca todas as entradas como vencidas, sem apagar: aparecem na hora e a versão nova é buscada. */
  expireAll() {
    const now = Date.now();
    for (const e of this.#mem.values()) e.exp = now;
    try {
      for (const k of Object.keys(this.#store)) {
        if (!k.startsWith(this.prefix)) continue;
        try {
          const e = JSON.parse(this.#store.getItem(k) ?? "") as CacheEntry;
          this.#store.setItem(k, JSON.stringify({ ...e, exp: now }));
        } catch {}
      }
    } catch {}
  }

  /** Remove entradas inválidas e velhas demais (ou todas as vencidas, com `aggressive`). */
  prune(aggressive = false) {
    try {
      const now = Date.now();
      for (const k of Object.keys(this.#store)) {
        if (!k.startsWith(this.prefix)) continue;
        try {
          const e = JSON.parse(this.#store.getItem(k) ?? "") as CacheEntry;
          const limit = aggressive ? e.exp : e.exp + MAX_STALE_MS;
          if (typeof e?.exp !== "number" || now > limit) this.#store.removeItem(k);
        } catch {
          this.#store.removeItem(k);
        }
      }
    } catch {}
  }

  #write(key: string, raw: string): boolean {
    try {
      this.#store.setItem(this.prefix + key, raw);
      return true;
    } catch {
      return false;
    }
  }

  /** Chaves deste cache, da que vence primeiro para a última. */
  #keysByAge(): string[] {
    try {
      return Object.keys(this.#store)
        .filter((k) => k.startsWith(this.prefix))
        .map((k) => {
          try {
            return { k, exp: (JSON.parse(this.#store.getItem(k) ?? "") as CacheEntry).exp ?? 0 };
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

/** Token salvo: o da aba (sessionStorage) tem preferência sobre o lembrado (localStorage). */
export function loadToken(): string {
  for (const store of [() => sessionStorage, () => localStorage]) {
    try {
      const t = store().getItem(TOKEN_KEY);
      if (t) return t;
    } catch {}
  }
  return "";
}

/** O token salvo é do tipo "lembrar neste computador" (ou não há token). */
export function tokenIsRemembered(): boolean {
  try {
    return !sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return true;
  }
}

/**
 * Salva o token. `remember` = false guarda só nesta aba (some ao fechar). `null` apaga dos dois lugares.
 * Sempre apaga do outro lugar, para não sobrar token esquecido.
 */
export function saveToken(token: string | null, remember = true) {
  for (const [store, keep] of [
    [() => localStorage, remember],
    [() => sessionStorage, !remember],
  ] as const) {
    try {
      if (token && keep) store().setItem(TOKEN_KEY, token);
      else store().removeItem(TOKEN_KEY);
    } catch {}
  }
}
