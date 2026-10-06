import { readyToLearn, topicKey, type Mastery, type MasteryState, type Objective } from './mastery';

export interface Size {
  w: number;
  h: number;
  gapX: number;
  gapY: number;
}

export const TOPIC: Size = { w: 212, h: 84, gapX: 46, gapY: 64 };

export const OBJECTIVE: Size = { w: 176, h: 44, gapX: 22, gapY: 50 };

const DUMMY = 14,
  PAD = 24;

type Point = [number, number];

interface Item {
  id: string;
  needs: string[];
}

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  layer: number;
}

export interface GraphLayout {
  nodes: Map<string, PlacedNode>;
  edges: { from: string; to: string; d: string }[];
  width: number;
  height: number;
  size: Size;
}

export const UNTAUGHT: MasteryState[] = ['planned', 'new', 'gap', 'misconception'];

export const ORDER: MasteryState[] = [
  'mastered',
  'right once',
  'taught',
  'shaky',
  'slipping',
  'misconception',
  'gap',
  'new',
  'planned',
];

export const IN = '@in:',
  OUT = '@out:';

/** Taught or better: what fills a topic's progress bar. */
export const LEARNED: MasteryState[] = ['mastered', 'right once', 'taught', 'shaky', 'slipping'];

/** Walking in order, drop each link that would close a loop: layouts need a DAG. */
function acyclic<T extends Item>(items: T[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i])),
    state = new Map<string, 1 | 2>(),
    keep = new Map<string, string[]>();
  const visit = (item: T) => {
    state.set(item.id, 1);
    const needs: string[] = [];
    for (const n of item.needs) {
      const t = byId.get(n);
      if (!t || state.get(n) === 1) {
        continue;
      }
      if (!state.has(n)) {
        visit(t);
      }
      needs.push(n);
    }
    keep.set(item.id, needs);
    state.set(item.id, 2);
  };
  for (const i of items) {
    if (!state.has(i.id)) {
      visit(i);
    }
  }
  return items.map((i) => ({ ...i, needs: keep.get(i.id) ?? [] }));
}

/** A path through the given points, curving between rows and running straight down through reserved gaps. */
function pathThrough(points: Point[]): string {
  let d = `M${points[0]![0]},${points[0]![1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!,
      [x1, y1] = points[i]!;
    d +=
      x0 === x1 ? ` L${x1},${y1}` : ` C${x0},${(y0 + y1) / 2} ${x1},${(y0 + y1) / 2} ${x1},${y1}`;
  }
  return d;
}

/**
 * A layered layout: each item one row below its deepest prerequisite, sources just above their first use, crowded
 * rows spilling end points down. Arrows that skip rows get reserved gaps so they run between nodes, not through them,
 * and barycenter sweeps order each row to reduce crossings.
 */
export function layoutGraph(
  input: Item[],
  size: Size,
  pinned: (id: string) => boolean = () => false,
): GraphLayout {
  const list = acyclic(input),
    byId = new Map(list.map((o) => [o.id, o])),
    layerOf = new Map<string, number>();
  const depth = (o: Item): number => {
    const known = layerOf.get(o.id);
    if (known !== undefined) {
      return known;
    }
    const d = o.needs.length ? 1 + Math.max(...o.needs.map((n) => depth(byId.get(n)!))) : 0;
    layerOf.set(o.id, d);
    return d;
  };
  list.forEach(depth);
  const dependents = new Map<string, string[]>();
  for (const o of list) {
    for (const n of o.needs) {
      dependents.set(n, [...(dependents.get(n) ?? []), o.id]);
    }
  }
  for (const o of list) {
    const users = dependents.get(o.id);
    if (!o.needs.length && users?.length && !pinned(o.id)) {
      layerOf.set(o.id, Math.min(...users.map((u) => layerOf.get(u)!)) - 1);
    }
  }
  const rows: string[][] = [];
  for (const o of list) {
    (rows[layerOf.get(o.id)!] ??= []).push(o.id);
  }
  for (let i = 0; i < rows.length; i++) {
    rows[i] ??= [];
  }
  const cap = Math.max(4, Math.ceil(Math.sqrt(list.length) * 1.25));
  for (let i = 0; i < rows.length; i++) {
    while (rows[i]!.length > cap) {
      const at = rows[i]!.findLastIndex((id) => !dependents.get(id)?.length);
      if (at < 0) {
        break;
      }
      const id = rows[i]!.splice(at, 1)[0]!;
      layerOf.set(id, i + 1);
      (rows[i + 1] ??= []).push(id);
    }
  }
  const up = new Map<string, string[]>(),
    down = new Map<string, string[]>(),
    chains: { from: string; to: string; via: string[] }[] = [];
  const link = (a: string, b: string) => {
    down.set(a, [...(down.get(a) ?? []), b]);
    up.set(b, [...(up.get(b) ?? []), a]);
  };
  for (const o of list) {
    for (const n of o.needs) {
      const a = layerOf.get(n)!,
        b = layerOf.get(o.id)!,
        via: string[] = [];
      let prev = n;
      for (let l = a + 1; l < b; l++) {
        const g = `~${n}>${o.id}@${l}`;
        rows[l]!.push(g);
        via.push(g);
        link(prev, g);
        prev = g;
      }
      link(prev, o.id);
      chains.push({ from: n, to: o.id, via });
    }
  }
  const pos = new Map<string, number>();
  const index = () =>
    rows.forEach((row) => row.forEach((id, i) => pos.set(id, (i + 0.5) / row.length)));
  const sweep = (row: string[], near: Map<string, string[]>) => {
    const score = new Map(
      row.map((id) => {
        const n = near.get(id) ?? [];
        return [id, n.length ? n.reduce((s, x) => s + pos.get(x)!, 0) / n.length : pos.get(id)!];
      }),
    );
    row.sort((a, b) => score.get(a)! - score.get(b)!);
  };
  index();
  for (let round = 0; round < 6; round++) {
    for (let i = 1; i < rows.length; i++) {
      sweep(rows[i]!, up);
      index();
    }
    for (let i = rows.length - 2; i >= 0; i--) {
      sweep(rows[i]!, down);
      index();
    }
  }
  const width = (id: string) => (id.startsWith('~') ? DUMMY : size.w);
  const rowWidth = (row: string[]) =>
    row.reduce((w, id) => w + width(id), 0) + Math.max(0, row.length - 1) * size.gapX;
  const inner = Math.max(size.w, ...rows.map(rowWidth)),
    x = new Map<string, number>(),
    y = new Map<string, number>();
  rows.forEach((row, l) => {
    let at = PAD + (inner - rowWidth(row)) / 2;
    for (const id of row) {
      x.set(id, at);
      y.set(id, PAD + l * (size.h + size.gapY));
      at += width(id) + size.gapX;
    }
  });
  const centre = (id: string) => x.get(id)! + width(id) / 2;
  const nodes = new Map(
    list.map((o) => [
      o.id,
      { id: o.id, x: x.get(o.id)!, y: y.get(o.id)!, layer: layerOf.get(o.id)! },
    ]),
  );
  const edges = chains.map((c) => ({
    from: c.from,
    to: c.to,
    d: pathThrough([
      [centre(c.from), y.get(c.from)! + size.h],
      ...c.via.flatMap((g) => [
        [centre(g), y.get(g)!] as Point,
        [centre(g), y.get(g)! + size.h] as Point,
      ]),
      [centre(c.to), y.get(c.to)!],
    ]),
  }));
  return {
    nodes,
    edges,
    width: inner + PAD * 2,
    height: rows.length * (size.h + size.gapY) - size.gapY + PAD * 2,
    size,
  };
}

export interface Topic {
  key: string;
  name: string;
  ids: string[];
  counts: Partial<Record<MasteryState, number>>;
  mastered: number;
  learned: number;
  warnings: number;
  ready: number;
  planned: boolean;
  needs: string[];
  weight: Map<string, number>;
}

export const hasTopics = (course: Mastery) => course.objectives.some((o) => topicKey(o.group));

/**
 * Topics come from the Group column and everything about them is derived from their objectives: progress, warnings,
 * and which topics they build on (any objective needing one in another topic). Nothing extra is stored.
 */
export function topicsOf(course: Mastery, ready = readyToLearn(course)): Topic[] {
  const topics = new Map<string, Topic>(),
    keyOf = new Map<string, string>();
  for (const o of course.objectives) {
    const key = topicKey(o.group);
    keyOf.set(o.id, key);
    let t = topics.get(key);
    if (!t) {
      topics.set(
        key,
        (t = {
          key,
          name: o.group?.trim().replace(/\s+/g, ' ') || 'Other',
          ids: [],
          counts: {},
          mastered: 0,
          learned: 0,
          warnings: 0,
          ready: 0,
          planned: true,
          needs: [],
          weight: new Map(),
        }),
      );
    }
    t.ids.push(o.id);
    t.counts[o.state] = (t.counts[o.state] ?? 0) + 1;
    if (o.state === 'mastered') {
      t.mastered++;
    }
    if (LEARNED.includes(o.state)) {
      t.learned++;
    }
    if (o.state === 'misconception' || o.state === 'slipping') {
      t.warnings++;
    }
    if (ready.has(o.id)) {
      t.ready++;
    }
    if (o.state !== 'planned') {
      t.planned = false;
    }
  }
  for (const o of course.objectives) {
    for (const n of o.needs) {
      const from = keyOf.get(n),
        to = keyOf.get(o.id)!;
      if (from === undefined || from === to) {
        continue;
      }
      const t = topics.get(to)!;
      t.weight.set(from, (t.weight.get(from) ?? 0) + 1);
      if (!t.needs.includes(from)) {
        t.needs.push(from);
      }
    }
  }
  return [...topics.values()];
}

/** One topic's objectives, with small links to the topics it builds on (above) and unlocks (below). */
export function layoutTopic(course: Mastery, key: string | undefined): GraphLayout {
  const inTopic = (o: Objective) => key === undefined || topicKey(o.group) === key;
  const ids = new Set(course.objectives.filter(inTopic).map((o) => o.id)),
    keyOf = new Map(course.objectives.map((o) => [o.id, topicKey(o.group)]));
  const items: Item[] = [],
    stubsIn = new Set<string>(),
    stubsOut = new Map<string, Set<string>>();
  for (const o of course.objectives) {
    if (ids.has(o.id)) {
      const needs = o.needs.filter((n) => ids.has(n));
      for (const n of o.needs) {
        if (!ids.has(n) && keyOf.has(n)) {
          const s = IN + keyOf.get(n)!;
          stubsIn.add(s);
          if (!needs.includes(s)) {
            needs.push(s);
          }
        }
      }
      items.push({ id: o.id, needs });
    } else {
      for (const n of o.needs) {
        if (ids.has(n)) {
          const s = OUT + keyOf.get(o.id)!;
          stubsOut.set(s, (stubsOut.get(s) ?? new Set()).add(n));
        }
      }
    }
  }
  return layoutGraph(
    [
      ...[...stubsIn].map((id) => ({ id, needs: [] })),
      ...items,
      ...[...stubsOut].map(([id, needs]) => ({ id, needs: [...needs] })),
    ],
    OBJECTIVE,
    (id) => id.startsWith(IN),
  );
}

/** Everything the target builds on that hasn't been taught yet, in the order to learn it, ending with the target. */
export function routeTo(course: Mastery, target: string): string[] {
  const byId = new Map(acyclic(course.objectives).map((o) => [o.id, o])),
    seen = new Set<string>(),
    order: string[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    for (const n of byId.get(id)?.needs ?? []) {
      visit(n);
    }
    order.push(id);
  };
  visit(target);
  return order.filter((id) => UNTAUGHT.includes(byId.get(id)?.state ?? 'new'));
}
