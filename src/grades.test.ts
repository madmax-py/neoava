import { describe, expect, it } from "vitest";
import type { GradeItem } from "./moodle/api";
import {
  accumulate,
  buildDeadlineIndex,
  buildMaxIndex,
  cyclesOf,
  difficultyOf,
  examsOf,
  isCurrent,
  isExam,
  itemCycles,
  parseGrade,
  pointsNeeded,
  semesterOf,
  standing,
} from "./grades";

const DAY = 86400;
let nextId = 1;

/** Item de atividade do quadro de notas. */
const mod = (o: Partial<GradeItem> & { categoryid: number }): GradeItem => ({
  id: nextId++,
  itemname: "Atividade",
  itemtype: "mod",
  itemmodule: "assign",
  iteminstance: 100_000 + nextId, // longe dos ids usados nos índices de prazo e valor
  graderaw: null,
  ...o,
});

/** Categoria do quadro de notas (iteminstance = id da categoria). */
const cat = (id: number, itemname: string | null): GradeItem => ({ id: nextId++, itemname, itemtype: "category", itemmodule: null, iteminstance: id });

/** Disciplina com VA1 (30/40 + 60 em aberto), VA2 (50/50, máximo vindo da tarefa) e VA3 vazia. */
function sample() {
  const items = [
    cat(10, "VA1"),
    cat(20, "VA2"),
    cat(30, "VA3"),
    mod({ categoryid: 10, grademax: 40, graderaw: 30 }),
    mod({ categoryid: 10, grademax: 60 }),
    mod({ categoryid: 20, grademax: 0, graderaw: 50, itemmodule: "assign", iteminstance: 900 }),
  ];
  const idx = buildMaxIndex([{ id: 900, grade: 50 }], []);
  return { items, idx };
}

describe("parseGrade", () => {
  it.each([
    ["7,50", 7.5],
    ["75,00 %", 7.5],
    ["85", 8.5],
    ["10", 10],
    ["-", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("%s → %s", (input, out) => expect(parseGrade(input)).toBe(out));
});

describe("semesterOf", () => {
  it("usa o fuso de São Paulo", () => {
    // 1º de janeiro 01:00 UTC ainda é 31 de dezembro no Brasil.
    expect(semesterOf(Date.UTC(2026, 0, 1, 1) / 1000)).toBe("2025/2");
    expect(semesterOf(Date.UTC(2026, 2, 1) / 1000)).toBe("2026/1");
    expect(semesterOf(Date.UTC(2026, 6, 15) / 1000)).toBe("2026/2");
  });
});

describe("isCurrent", () => {
  const now = Date.UTC(2026, 9, 1) / 1000;
  it("disciplina em andamento", () => expect(isCurrent({ startdate: now - 30 * DAY, enddate: now + 30 * DAY } as never, now)).toBe(true));
  it("terminou há pouco (até 15 dias)", () => expect(isCurrent({ startdate: now - 120 * DAY, enddate: now - 10 * DAY } as never, now)).toBe(true));
  it("terminou há muito", () => expect(isCurrent({ startdate: now - 200 * DAY, enddate: now - 20 * DAY } as never, now)).toBe(false));
  it("começa daqui a mais de 30 dias", () => expect(isCurrent({ startdate: now + 40 * DAY, enddate: now + 200 * DAY } as never, now)).toBe(false));
  it("sem término: atual se começou há menos de ~7 meses", () => {
    expect(isCurrent({ startdate: now - 100 * DAY, enddate: 0 } as never, now)).toBe(true);
    expect(isCurrent({ startdate: now - 300 * DAY, enddate: 0 } as never, now)).toBe(false);
  });
});

describe("accumulate", () => {
  it("soma obtido, perdido e em aberto; ignora itens sem valor conhecido", () => {
    const { items, idx } = sample();
    items.push(mod({ categoryid: 30, graderaw: 5 })); // sem máximo: não entra nas contas
    const acc = accumulate(items, idx)!;
    expect(acc).toMatchObject({ earned: 80, lost: 10, open: 60, total: 150, unknown: 1, unknownGraded: 1 });
    expect(acc.pieces.find((p) => p.max === 50)?.maxFromActivity).toBe(true);
  });

  it("nota acima do máximo não passa do máximo", () => {
    const acc = accumulate([mod({ categoryid: 1, grademax: 10, graderaw: 12 })])!;
    expect(acc).toMatchObject({ earned: 10, lost: 0 });
    expect(acc.pieces[0].pct).toBe(1);
  });

  it("sem itens de nota → null", () => expect(accumulate([cat(1, "VA1")])).toBeNull());
});

describe("cyclesOf", () => {
  const course = { startdate: 1000, enddate: 1000 + 90 * DAY };

  it("calcula pontos por ciclo e as médias", () => {
    const { items, idx } = sample();
    const s = cyclesOf(items, idx, course, course.startdate + 50 * DAY)!;
    expect(s.cycles.map((c) => c.label)).toEqual(["VA1", "VA2", "VA3"]);
    expect(s.cycles[0]).toMatchObject({ earned: 30, lost: 10, open: 60, notReleased: 0, graded: 1, items: 2 });
    expect(s.cycles[1]).toMatchObject({ earned: 50, lost: 0, open: 0, notReleased: 50 });
    expect(s.cycles[2]).toMatchObject({ earned: 0, lost: 0, open: 0, notReleased: 100 });
    expect(s.secured).toBeCloseTo(80 / 3);
    // Falta: 60 da VA1 + 50 da VA2 + 100 da VA3.
    expect(s.maxPossible).toBeCloseTo((80 + 210) / 3);
    expect(s.efficiency).toBeCloseTo(80 / 90);
    expect(s.projected).toBeCloseTo((80 + (80 / 90) * 210) / 3);
    expect(s.current).toBe(1);
  });

  it("ciclo atual avança se já houver nota num ciclo posterior", () => {
    const { items, idx } = sample();
    expect(cyclesOf(items, idx, course, course.startdate + DAY)!.current).toBe(1);
  });

  it("ciclo atual pelas datas, sem notas", () => {
    const items = [cat(1, "VA1"), cat(2, "VA2"), cat(3, "VA3")];
    expect(cyclesOf(items, undefined, course, course.startdate + DAY)!.current).toBe(0);
    expect(cyclesOf(items, undefined, course, course.startdate + 80 * DAY)!.current).toBe(2);
    expect(cyclesOf(items, undefined, course, course.enddate + 100 * DAY)!.current).toBe(2);
  });

  it("limita cada ciclo a 100 pontos", () => {
    const items = [cat(1, "VA1"), cat(2, "VA2"), cat(3, "VA3"), mod({ categoryid: 1, grademax: 80, graderaw: 80 }), mod({ categoryid: 1, grademax: 80, graderaw: 40 })];
    const c = cyclesOf(items)!.cycles[0];
    expect(c.earned).toBe(100);
    expect(c.earned + c.lost + c.open).toBeLessThanOrEqual(100);
  });

  it("aceita FASE 01–03 e categorias sem nome com atividades de um só ciclo", () => {
    const items = [cat(1, "FASE 01"), cat(2, null), cat(3, "Fase 3"), mod({ categoryid: 2, itemname: "FASE 02 - ENTREGA" })];
    expect(cyclesOf(items)!.cycles.map((c) => c.label)).toEqual(["Fase 1", "Fase 2", "Fase 3"]);
  });

  it("fora do modelo → null", () => {
    expect(cyclesOf([cat(1, "VA1"), cat(2, "VA2")])).toBeNull();
    expect(cyclesOf([cat(1, "VA1"), cat(2, "VA2"), cat(3, "Trabalhos")])).toBeNull();
    expect(cyclesOf([cat(1, "VA1"), cat(2, "VA2"), cat(3, "VA2")])).toBeNull();
  });

  it("itens fora das categorias aparecem como soltos", () => {
    const { items, idx } = sample();
    items.push(mod({ categoryid: 99, itemname: "Extra", graderaw: 4 }));
    expect(cyclesOf(items, idx)!.loose).toEqual({ count: 1, earned: 4, names: ["Extra"] });
  });
});

describe("standing e pointsNeeded", () => {
  const summary = (earned: [number, number, number], lost: [number, number, number]) => {
    const items = [cat(1, "VA1"), cat(2, "VA2"), cat(3, "VA3")];
    earned.forEach((e, i) => {
      if (e + lost[i] > 0) items.push(mod({ categoryid: i + 1, grademax: e + lost[i], graderaw: e }));
    });
    return cyclesOf(items)!;
  };

  it("garantido", () => expect(standing(summary([70, 70, 70], [30, 30, 30]), 60)).toBe("secured"));
  it("impossível", () => expect(standing(summary([10, 10, 0], [90, 90, 0]), 60)).toBe("impossible"));
  it("no caminho", () => expect(standing(summary([90, 0, 0], [10, 0, 0]), 60)).toBe("on-track"));
  it("em risco", () => expect(standing(summary([40, 0, 0], [60, 0, 0]), 60)).toBe("at-risk"));
  it("sem dados", () => expect(standing(summary([0, 0, 0], [0, 0, 0]), 60)).toBe("no-data"));
  it("pontos que faltam", () => {
    expect(pointsNeeded(summary([90, 0, 0], [10, 0, 0]), 60)).toBe(90);
    expect(pointsNeeded(summary([100, 100, 100], [0, 0, 0]), 60)).toBe(0);
  });
});

describe("isExam", () => {
  it.each([
    ["1ª VA - Verificação de Aprendizagem", true],
    ["2a VA", true],
    ["Prova 1", true],
    ["P2", true],
    ["Avaliação escrita", true],
    ["Devolutiva 2º VA", false],
    ["Simulado da prova", false],
    ["Revisão para a prova", false],
    ["Atividade Avaliativa", false],
    ["Fórum", false],
    [null, false],
  ])("%s → %s", (name, out) => expect(isExam(name)).toBe(out));
});

describe("examsOf e difficultyOf", () => {
  const now = 10_000_000;
  const dl = buildDeadlineIndex(
    [
      { id: 1, duedate: now - DAY },
      { id: 2, duedate: now + DAY },
    ],
    [],
  );

  it("classifica as provas pela nota e pelo prazo", () => {
    const items = [
      mod({ categoryid: 1, itemname: "1ª VA", grademax: 10, graderaw: 8 }),
      mod({ categoryid: 1, itemname: "2ª VA", iteminstance: 1, grademax: 10 }),
      mod({ categoryid: 1, itemname: "3ª VA", iteminstance: 2, grademax: 10 }),
      mod({ categoryid: 1, itemname: "Prova final", iteminstance: 3, grademax: 10 }),
      mod({ categoryid: 1, itemname: "Trabalho", grademax: 10, graderaw: 10 }),
    ];
    expect(examsOf(items, undefined, dl, now).map((e) => e.state)).toEqual(["graded", "awaiting", "upcoming", "undated"]);
  });

  it("prova abaixo da média é dificuldade, mesmo com atividades boas", () => {
    const items = [mod({ categoryid: 1, itemname: "1ª VA", grademax: 10, graderaw: 4 }), mod({ categoryid: 1, itemname: "Trabalho", grademax: 10, graderaw: 10 })];
    const d = difficultyOf(examsOf(items), accumulate(items)!.pieces, 0.6);
    expect(d).toMatchObject({ level: "bad", exam: 0.4, others: 1, overall: 0.7 });
  });

  it("prova bem abaixo das atividades é alerta", () => {
    const items = [mod({ categoryid: 1, itemname: "1ª VA", grademax: 10, graderaw: 8 }), mod({ categoryid: 1, itemname: "Trabalho", grademax: 10, graderaw: 10 })];
    expect(difficultyOf(examsOf(items), accumulate(items)!.pieces, 0.6).level).toBe("warn");
  });

  it("sem prova corrigida", () => {
    const items = [mod({ categoryid: 1, itemname: "Trabalho", grademax: 10, graderaw: 10 })];
    expect(difficultyOf(examsOf(items), accumulate(items)!.pieces, 0.6)).toMatchObject({ level: "no-exam", reason: "Sem prova no quadro de notas" });
  });
});

describe("itemCycles", () => {
  it("categoria, depois nome, depois prazo", () => {
    const course = { id: 1, startdate: DAY, enddate: 91 * DAY } as never;
    const dl = buildDeadlineIndex([{ id: 500, duedate: 70 * DAY }], []);
    const items = [cat(1, "VA1"), cat(2, "VA2"), cat(3, "VA3")];
    const byCat = mod({ categoryid: 2 });
    const byName = mod({ categoryid: 99, itemname: "FASE 02 - ENTREGA" });
    const byDate = mod({ categoryid: 99, itemname: "Trabalho", iteminstance: 500 });
    const none = mod({ categoryid: 99, itemname: "Trabalho" });
    items.push(byCat, byName, byDate, none);
    const out = itemCycles(items, course, cyclesOf(items), dl);
    expect([out.get(byCat.id), out.get(byName.id), out.get(byDate.id), out.get(none.id)]).toEqual([2, 2, 3, null]);
  });
});
