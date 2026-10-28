import { describe, expect, it } from "vitest";
import { crc32, safeName, uniquePath, zip } from "./zip";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("zip", () => {
  it("crc32 bate com o valor de referência", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
  });

  it("monta um ZIP legível: cabeçalhos, nomes em UTF-8 e diretório central", async () => {
    const buf = new Uint8Array(await zip([{ name: "Aula 1.pdf", data: bytes("abc") }, { name: "Pasta/ação.txt", data: bytes("") }]).arrayBuffer());
    const v = new DataView(buf.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = buf.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const cen = v.getUint32(end + 16, true);
    expect(v.getUint32(cen, true)).toBe(0x02014b50);
    expect(v.getUint32(cen + 16, true)).toBe(crc32(bytes("abc")));
    const second = cen + 46 + bytes("Aula 1.pdf").length;
    const nameLen = v.getUint16(second + 28, true);
    expect(new TextDecoder().decode(buf.subarray(second + 46, second + 46 + nameLen))).toBe("Pasta/ação.txt");
    expect(buf.length).toBe(cen + v.getUint32(end + 12, true) + 22);
  });

  it("nomes seguros e sem repetição", () => {
    expect(safeName('Slides: "VA1"?')).toBe("Slides_ _VA1_");
    const used = new Set<string>();
    expect(["a.pdf", "A.pdf", "a.pdf", "b"].map((p) => uniquePath(p, used))).toEqual(["a.pdf", "A (2).pdf", "a (3).pdf", "b"]);
  });
});
