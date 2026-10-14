import type { Cache } from "./moodle/client";

/** Cache com TTL no localStorage. Falhas de storage (modo privado, cota) são ignoradas. */
export class LocalStorageCache implements Cache {
  constructor(private prefix = "ava-cache:") {}

  get(key: string) {
    try {
      const raw = localStorage.getItem(this.prefix + key);
      if (!raw) return undefined;
      const { v, exp } = JSON.parse(raw);
      if (Date.now() > exp) {
        localStorage.removeItem(this.prefix + key);
        return undefined;
      }
      return v;
    } catch {
      return undefined;
    }
  }
  set(key: string, v: unknown, ttl: number) {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify({ v, exp: Date.now() + ttl * 1000 }));
    } catch {}
  }
  clear() {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(this.prefix)) localStorage.removeItem(k);
    } catch {}
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
