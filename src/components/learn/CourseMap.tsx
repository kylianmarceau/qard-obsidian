import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  ChevronLeft,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Route,
  Scan,
  Search,
  X,
} from 'lucide-react';
import type { Mastery, MasteryState, Objective } from '../../learn/mastery';
import type { LessonSummary } from '../../learn/learn-types';
import { isoDay, readyToLearn, shortLabel, topicKey } from '../../learn/mastery';
import { STATE_LABEL, StateChip, relativeDay } from './common';
import { InlineMarkdown } from '../Markdown';
import type { QardServices } from '../../views/services';

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
const UNTAUGHT: MasteryState[] = ['planned', 'new', 'gap', 'misconception'];
const ORDER: MasteryState[] = [
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
const IN = '@in:',
  OUT = '@out:';
/** Taught or better: what fills a topic's progress bar. */
const LEARNED: MasteryState[] = ['mastered', 'right once', 'taught', 'shaky', 'slipping'];

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
      if (!t || state.get(n) === 1) continue;
      if (!state.has(n)) visit(t);
      needs.push(n);
    }
    keep.set(item.id, needs);
    state.set(item.id, 2);
  };
  for (const i of items) if (!state.has(i.id)) visit(i);
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
    if (known !== undefined) return known;
    const d = o.needs.length ? 1 + Math.max(...o.needs.map((n) => depth(byId.get(n)!))) : 0;
    layerOf.set(o.id, d);
    return d;
  };
  list.forEach(depth);
  const dependents = new Map<string, string[]>();
  for (const o of list)
    for (const n of o.needs) dependents.set(n, [...(dependents.get(n) ?? []), o.id]);
  for (const o of list) {
    const users = dependents.get(o.id);
    if (!o.needs.length && users?.length && !pinned(o.id))
      layerOf.set(o.id, Math.min(...users.map((u) => layerOf.get(u)!)) - 1);
  }
  const rows: string[][] = [];
  for (const o of list) (rows[layerOf.get(o.id)!] ??= []).push(o.id);
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  const cap = Math.max(4, Math.ceil(Math.sqrt(list.length) * 1.25));
  for (let i = 0; i < rows.length; i++)
    while (rows[i]!.length > cap) {
      const at = rows[i]!.findLastIndex((id) => !dependents.get(id)?.length);
      if (at < 0) break;
      const id = rows[i]!.splice(at, 1)[0]!;
      layerOf.set(id, i + 1);
      (rows[i + 1] ??= []).push(id);
    }
  const up = new Map<string, string[]>(),
    down = new Map<string, string[]>(),
    chains: { from: string; to: string; via: string[] }[] = [];
  const link = (a: string, b: string) => {
    down.set(a, [...(down.get(a) ?? []), b]);
    up.set(b, [...(up.get(b) ?? []), a]);
  };
  for (const o of list)
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
    if (!t)
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
    t.ids.push(o.id);
    t.counts[o.state] = (t.counts[o.state] ?? 0) + 1;
    if (o.state === 'mastered') t.mastered++;
    if (LEARNED.includes(o.state)) t.learned++;
    if (o.state === 'misconception' || o.state === 'slipping') t.warnings++;
    if (ready.has(o.id)) t.ready++;
    if (o.state !== 'planned') t.planned = false;
  }
  for (const o of course.objectives)
    for (const n of o.needs) {
      const from = keyOf.get(n),
        to = keyOf.get(o.id)!;
      if (from === undefined || from === to) continue;
      const t = topics.get(to)!;
      t.weight.set(from, (t.weight.get(from) ?? 0) + 1);
      if (!t.needs.includes(from)) t.needs.push(from);
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
      for (const n of o.needs)
        if (!ids.has(n) && keyOf.has(n)) {
          const s = IN + keyOf.get(n)!;
          stubsIn.add(s);
          if (!needs.includes(s)) needs.push(s);
        }
      items.push({ id: o.id, needs });
    } else
      for (const n of o.needs)
        if (ids.has(n)) {
          const s = OUT + keyOf.get(o.id)!;
          stubsOut.set(s, (stubsOut.get(s) ?? new Set()).add(n));
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
    if (seen.has(id)) return;
    seen.add(id);
    for (const n of byId.get(id)?.needs ?? []) visit(n);
    order.push(id);
  };
  visit(target);
  return order.filter((id) => UNTAUGHT.includes(byId.get(id)?.state ?? 'new'));
}

const cls = (state: MasteryState) => `qard-node-${state.replace(' ', '-')}`;
export interface MapActions {
  teach: (o: Objective) => void;
  openLesson?: (path: string) => void;
  check?: (o: Objective) => void;
  openNote: (note: string) => void;
  busy?: (id: string) => boolean;
}

/**
 * The course map. It opens on topics (one node per Group, with progress and warnings); clicking a topic drills into
 * its objectives. Pan, zoom, search, filter by state, select for details, and plan a route to any objective.
 */
/** initial: an objective to open the map at (its topic drilled into, the objective selected). lessons: this course's lessons. */
export function CourseMap({
  course,
  actions,
  filter,
  today = isoDay(Date.now()),
  lessons = [],
  initial,
  services,
}: {
  course: Mastery;
  actions: MapActions;
  filter?: Set<string>;
  today?: string;
  lessons?: LessonSummary[];
  initial?: string;
  services?: QardServices;
}) {
  // Titles may hold maths; render them when the renderer is available.
  const md = (text: string) =>
    services ? <InlineMarkdown text={text} path={course.path} services={services} /> : text;
  const grouped = hasTopics(course);
  const ready = useMemo(() => readyToLearn(course), [course]);
  const topics = useMemo(() => topicsOf(course, ready), [course, ready]);
  const byId = useMemo(() => new Map(course.objectives.map((o) => [o.id, o])), [course]);
  // Lessons in progress are marked on the map and continued from the panel.
  const inProgress = useMemo(
    () =>
      new Map(lessons.filter((l) => !l.finished && l.objective).map((l) => [l.objective!, l.path])),
    [lessons],
  );
  const start = initial && byId.has(initial) ? initial : undefined;
  const [topic, setTopic] = useState<string | undefined>(
      start && grouped ? topicKey(byId.get(start)?.group) : undefined,
    ),
    [selected, setSelected] = useState<string | undefined>(start),
    [hovered, setHovered] = useState<string>(),
    [cursor, setCursor] = useState<string>();
  const [route, setRoute] = useState<string[]>(),
    [query, setQuery] = useState(''),
    [expanded, setExpanded] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 }),
    [animate, setAnimate] = useState(false);
  const box = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null),
    drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | undefined>(
      undefined,
    ),
    pending = useRef<string | undefined>(start);
  const atTopics = grouped && topic === undefined;
  const layout = useMemo(
    () =>
      atTopics
        ? layoutGraph(
            topics.map((t) => ({ id: t.key, needs: t.needs })),
            TOPIC,
          )
        : layoutTopic(course, grouped ? topic : undefined),
    [atTopics, topics, course, grouped, topic],
  );
  const topicOf = useCallback((id: string) => topicKey(byId.get(id)?.group), [byId]);
  const dependents = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of layout.edges) m.set(e.from, [...(m.get(e.from) ?? []), e.to]);
    return m;
  }, [layout]);
  const allDependents = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const o of course.objectives)
      for (const n of o.needs) m.set(n, [...(m.get(n) ?? []), o.id]);
    return m;
  }, [course]);

  const moveTo = useCallback((next: { x: number; y: number; k: number }, smooth = true) => {
    setAnimate(smooth);
    setView(next);
    if (smooth) window.setTimeout(() => setAnimate(false), 320);
  }, []);
  /** Frames the given nodes (all by default), leaving room for the toolbars and the side panel. */
  const frame = useCallback(
    (ids?: string[], smooth = true, panel = false) => {
      const el = box.current;
      if (!el || !el.clientWidth) return;
      const points = (ids ?? [...layout.nodes.keys()])
        .map((id) => layout.nodes.get(id))
        .filter((p): p is PlacedNode => !!p);
      if (!points.length) return;
      const { w, h } = layout.size,
        minX = Math.min(...points.map((p) => p.x)) - 16,
        minY = Math.min(...points.map((p) => p.y)) - 16;
      const maxX = Math.max(...points.map((p) => p.x + w)) + 16,
        maxY = Math.max(...points.map((p) => p.y + h)) + 16;
      const top = 60,
        width = el.clientWidth - (panel ? 336 : 0) - 32,
        height = el.clientHeight - top - 20;
      const fitted = Math.min(1, width / (maxX - minX), height / (maxY - minY)),
        k = Math.max(fitted, 0.6);
      moveTo(
        {
          k,
          x: 16 + (k === fitted ? (width - (maxX - minX) * k) / 2 : 0) - minX * k,
          y: top + (k === fitted ? (height - (maxY - minY) * k) / 2 : 0) - minY * k,
        },
        smooth,
      );
    },
    [layout, moveTo],
  );
  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) =>
      setView((v) => {
        const k = Math.min(2, Math.max(0.3, v.k * factor));
        return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
      }),
    [],
  );
  const zoomBy = (factor: number) => {
    const el = box.current;
    if (el) {
      setAnimate(true);
      zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor);
      window.setTimeout(() => setAnimate(false), 320);
    }
  };
  const focus = useCallback(
    (id: string) => {
      const el = box.current,
        p = layout.nodes.get(id);
      if (!el || !p) return;
      const k = Math.max(view.k, 0.9);
      moveTo({
        k,
        x: (el.clientWidth - 320) / 2 - (p.x + layout.size.w / 2) * k,
        y: el.clientHeight / 2 - (p.y + layout.size.h / 2) * k,
      });
    },
    [layout, view.k, moveTo],
  );

  // Each level opens framed; an objective chosen from another topic is focused once its topic is drawn.
  const latest = useRef({ focus, frame });
  latest.current = { focus, frame };
  useEffect(() => {
    const id = pending.current;
    pending.current = undefined;
    if (id && layout.nodes.has(id)) latest.current.focus(id);
    else latest.current.frame(undefined, false);
  }, [layout, expanded]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey)
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  const enter = (key: string | undefined) => {
    setTopic(key);
    setHovered(undefined);
    setCursor(undefined);
    if (key === undefined) setSelected(undefined);
  };
  /** Selects an objective, switching to its topic first when needed. */
  const open = (id: string | undefined, centre = false) => {
    setSelected(id);
    if (!id || !route?.includes(id)) setRoute(undefined);
    if (!id) return;
    if (grouped && topicOf(id) !== topic) {
      pending.current = id;
      enter(topicOf(id));
      setSelected(id);
    } else if (centre) focus(id);
  };
  const related = useMemo(() => {
    const target = atTopics ? (hovered ?? cursor) : (selected ?? hovered);
    if (!target || target.startsWith('@')) return undefined;
    const set = new Set([target]),
      needsOf = (id: string) =>
        atTopics
          ? (topics.find((t) => t.key === id)?.needs ?? [])
          : layout.edges.filter((e) => e.to === id).map((e) => e.from);
    if (atTopics || !selected) {
      for (const n of needsOf(target)) set.add(n);
      for (const d of dependents.get(target) ?? []) set.add(d);
      return set;
    }
    const upward = [target],
      downward = [target];
    while (upward.length)
      for (const n of needsOf(upward.pop()!))
        if (!set.has(n)) {
          set.add(n);
          upward.push(n);
        }
    while (downward.length)
      for (const d of dependents.get(downward.pop()!) ?? [])
        if (!set.has(d)) {
          set.add(d);
          downward.push(d);
        }
    return set;
  }, [atTopics, hovered, cursor, selected, topics, layout, dependents]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? course.objectives
            .filter((o) =>
              [o.title, o.label ?? '', o.id, o.group ?? ''].some((t) =>
                t.toLowerCase().includes(q),
              ),
            )
            .map((o) => o.id)
        : [],
    [q, course],
  );
  const passes = (o: Objective) =>
    !filter?.size || filter.has(o.state) || (filter.has('ready') && ready.has(o.id));
  const dimTopic = (t: Topic) =>
    (related ? !related.has(t.key) : false) ||
    (!!q && !t.ids.some((id) => matches.includes(id))) ||
    (!!filter?.size && !t.ids.some((id) => passes(byId.get(id)!)));
  const dimObjective = (id: string) =>
    (route ? !route.includes(id) : related ? !related.has(id) : false) ||
    (!!q && !matches.includes(id)) ||
    !passes(byId.get(id)!);

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT') {
      if (e.key === 'Escape') {
        setQuery('');
        box.current?.focus();
      }
      return;
    }
    const current = atTopics ? cursor : selected,
      p = current ? layout.nodes.get(current) : undefined;
    const move = (id?: string) => {
      if (!id) return;
      e.preventDefault();
      if (atTopics) setCursor(id);
      else if (!id.startsWith('@')) open(id, true);
    };
    if (e.key === '/') {
      e.preventDefault();
      search.current?.focus();
    } else if (e.key === 'Escape') {
      if (selected) open(undefined);
      else if (grouped && !atTopics) enter(undefined);
      else if (expanded) setExpanded(false);
    } else if (e.key === 'Enter' && atTopics && cursor) enter(cursor);
    else if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-') zoomBy(0.8);
    else if (e.key === '0') frame();
    else if (!p) {
      if (e.key.startsWith('Arrow'))
        move([...layout.nodes.keys()].find((id) => !id.startsWith('@')));
    } else if (e.key === 'ArrowUp')
      move(layout.edges.find((x) => x.to === p.id && !x.from.startsWith('@'))?.from);
    else if (e.key === 'ArrowDown') move(dependents.get(p.id)?.find((id) => !id.startsWith('@')));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const row = [...layout.nodes.values()]
        .filter((n) => n.layer === p.layer && !n.id.startsWith('@'))
        .sort((a, b) => a.x - b.x);
      move(row[row.findIndex((n) => n.id === p.id) + (e.key === 'ArrowLeft' ? -1 : 1)]?.id);
    }
  }
  const pointerDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('.qard-map-node, .qard-map-panel, .qard-map-tools')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const pointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const pointerUp = () => {
    const d = drag.current;
    drag.current = undefined;
    if (d && !d.moved) {
      open(undefined);
      setCursor(undefined);
    }
  };

  if (!course.objectives.length) return null;
  const { w, h } = layout.size,
    current = topics.find((t) => t.key === topic);
  const chosen = selected ? byId.get(selected) : undefined;
  const status = (o: Objective) =>
    o.state === 'planned'
      ? 'Not covered yet'
      : ready.has(o.id)
        ? 'Ready to learn'
        : o.due && !['new', 'gap', 'misconception', 'mastered'].includes(o.state)
          ? `${STATE_LABEL[o.state]} · check ${relativeDay(o.due, today)}`
          : STATE_LABEL[o.state];
  const titleOf = (id: string) => byId.get(id)?.title ?? id;
  const links = (ids: string[]) =>
    ids.map((n) => (
      <button key={n} className="qard-map-link" onClick={() => open(n, true)}>
        <i className={cls(byId.get(n)?.state ?? 'new')} />
        {md(titleOf(n))}
        {grouped && topicOf(n) !== topic ? (
          <small className="qard-muted">{byId.get(n)?.group}</small>
        ) : null}
      </button>
    ));
  const topicName = (key: string) => topics.find((t) => t.key === key)?.name ?? key;
  const routeCount = (t: Topic) => (route ? t.ids.filter((id) => route.includes(id)).length : 0);

  return (
    <div
      className={
        'qard-map-frame' +
        (expanded ? ' is-expanded' : '') +
        (chosen && !atTopics ? ' is-panel-open' : '')
      }
      ref={box}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      aria-label={`${course.course} course map. Arrow keys move, Enter opens a topic, / searches, Escape goes back.`}
    >
      <svg
        className="qard-map"
        width="100%"
        height="100%"
        role="group"
        aria-label={
          atTopics ? `${course.course} topics` : `${current?.name ?? course.course} objectives`
        }
      >
        <defs>
          <marker
            id="qard-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerUnits="userSpaceOnUse"
            markerWidth="10"
            markerHeight="10"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L9,5 L0,9 z" className="qard-arrow-head" />
          </marker>
          <marker
            id="qard-arrow-on"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerUnits="userSpaceOnUse"
            markerWidth="11"
            markerHeight="11"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L9,5 L0,9 z" className="qard-arrow-head is-on" />
          </marker>
        </defs>
        <g
          className={animate ? 'is-animating' : ''}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
          {layout.edges.map((e) => {
            const on =
              !atTopics && route
                ? route.includes(e.from) && route.includes(e.to)
                : related
                  ? related.has(e.from) && related.has(e.to)
                  : false;
            const weight = atTopics
              ? (topics.find((t) => t.key === e.to)?.weight.get(e.from) ?? 1)
              : 1;
            const stub = e.from.startsWith('@') || e.to.startsWith('@');
            return (
              <path
                key={e.from + '>' + e.to}
                className={
                  'qard-map-edge' +
                  (on ? ' is-on' : related || (!atTopics && route) ? ' is-dim' : '') +
                  (stub ? ' is-stub' : '')
                }
                d={e.d}
                markerEnd={`url(#${on ? 'qard-arrow-on' : 'qard-arrow'})`}
                style={atTopics ? { strokeWidth: 1.4 + Math.min(weight, 6) * 0.55 } : undefined}
              />
            );
          })}
          {atTopics
            ? topics.map((t) => {
                const p = layout.nodes.get(t.key)!,
                  total = t.ids.length,
                  barW = w - 32,
                  steps = routeCount(t);
                let at = 0;
                const names = [
                  'qard-map-node',
                  'qard-topic-node',
                  t.planned ? 'is-planned' : '',
                  cursor === t.key ? 'is-selected' : '',
                  dimTopic(t) ? 'is-dim' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <g
                    key={t.key}
                    className={names}
                    transform={`translate(${p.x},${p.y})`}
                    role="button"
                    tabIndex={-1}
                    aria-label={`${t.name}: ${t.learned} of ${total} learned, ${t.mastered} mastered${t.warnings ? `, ${t.warnings} to fix` : ''}${t.ready ? `, ${t.ready} ready to learn` : ''}`}
                    onPointerEnter={() => setHovered(t.key)}
                    onPointerLeave={() => setHovered((x) => (x === t.key ? undefined : x))}
                    onClick={(e) => {
                      e.stopPropagation();
                      enter(t.key);
                    }}
                  >
                    <title>{`${t.name}\n${ORDER.filter((x) => t.counts[x])
                      .map((x) => `${t.counts[x]} ${STATE_LABEL[x].toLowerCase()}`)
                      .join(', ')}`}</title>
                    <rect className="qard-map-card" width={w} height={h} rx={14} />
                    <foreignObject x={16} y={12} width={w - 32 - (t.warnings ? 40 : 0)} height={24}>
                      <div className="qard-map-text qard-topic-name">{t.name}</div>
                    </foreignObject>
                    {t.warnings > 0 && (
                      <g className="qard-topic-warn" transform={`translate(${w - 16},20)`}>
                        <text textAnchor="end">⚠ {t.warnings}</text>
                      </g>
                    )}
                    <g transform={`translate(16,42)`}>
                      <rect className="qard-topic-track" width={barW} height={8} rx={4} />
                      {LEARNED.map((s) => {
                        const n = t.counts[s] ?? 0;
                        if (!n) return null;
                        const seg = (
                          <rect
                            key={s}
                            className={'qard-topic-seg ' + cls(s)}
                            x={at}
                            width={Math.max(2, (n / total) * barW - 1)}
                            height={8}
                            rx={2}
                          />
                        );
                        at += (n / total) * barW;
                        return seg;
                      })}
                    </g>
                    <foreignObject x={16} y={58} width={w - 32} height={18}>
                      <div className="qard-map-text qard-topic-meta">
                        {t.planned ? 'Not covered yet' : `${t.learned} of ${total} learned`}
                        {t.ids.some((id) => inProgress.has(id)) ? (
                          <span className="qard-topic-ready"> · lesson in progress</span>
                        ) : (
                          !t.planned &&
                          t.ready > 0 && (
                            <span className="qard-topic-ready"> · {t.ready} ready</span>
                          )
                        )}
                      </div>
                    </foreignObject>
                    {steps > 0 && (
                      <g className="qard-map-step" transform={`translate(${w - 2},2)`}>
                        <circle r={11} />
                        <text textAnchor="middle" y={4}>
                          {steps}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })
            : [...layout.nodes.values()].map((p) => {
                if (p.id.startsWith('@')) {
                  const key = p.id.slice(IN.length),
                    incoming = p.id.startsWith(IN);
                  return (
                    <g
                      key={p.id}
                      className="qard-map-node qard-map-stub"
                      transform={`translate(${p.x},${p.y + 8})`}
                      role="button"
                      tabIndex={-1}
                      aria-label={`${incoming ? 'Builds on' : 'Unlocks'} ${topicName(key)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        enter(key);
                      }}
                    >
                      <rect width={w} height={h - 16} rx={(h - 16) / 2} />
                      <foreignObject x={10} y={0} width={w - 20} height={h - 16}>
                        <div className="qard-map-text qard-map-stub-label">
                          {incoming ? '↑ ' : '↓ '}
                          {topicName(key)}
                        </div>
                      </foreignObject>
                    </g>
                  );
                }
                const o = byId.get(p.id)!,
                  step = route ? route.indexOf(o.id) : -1;
                const names = [
                  'qard-map-node',
                  cls(o.state),
                  ready.has(o.id) ? 'is-ready' : '',
                  selected === o.id ? 'is-selected' : '',
                  dimObjective(o.id) ? 'is-dim' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <g
                    key={p.id}
                    className={names}
                    transform={`translate(${p.x},${p.y})`}
                    role="button"
                    tabIndex={-1}
                    aria-pressed={selected === o.id}
                    aria-label={`${o.title}: ${STATE_LABEL[o.state]}${ready.has(o.id) ? ', ready to learn' : ''}${inProgress.has(o.id) ? ', lesson in progress' : ''}`}
                    onPointerEnter={() => setHovered(o.id)}
                    onPointerLeave={() => setHovered((x) => (x === o.id ? undefined : x))}
                    onClick={(e) => {
                      e.stopPropagation();
                      open(selected === o.id ? undefined : o.id);
                    }}
                    onDoubleClick={(e: MouseEvent) => {
                      e.stopPropagation();
                      open(o.id, true);
                    }}
                  >
                    <title>{o.title}</title>
                    <rect className="qard-map-card" width={w} height={h} rx={10} />
                    <rect className="qard-map-bar" x={9} y={10} width={4} height={h - 20} rx={2} />
                    <foreignObject
                      x={20}
                      y={3}
                      width={w - 28 - (step >= 0 ? 10 : 0)}
                      height={h - 6}
                    >
                      <div className="qard-map-label">
                        <span className="qard-map-title">{md(shortLabel(o))}</span>
                      </div>
                    </foreignObject>
                    {step >= 0 ? (
                      <g className="qard-map-step" transform={`translate(${w - 2},2)`}>
                        <circle r={11} />
                        <text textAnchor="middle" y={4}>
                          {step + 1}
                        </text>
                      </g>
                    ) : (
                      inProgress.has(o.id) && (
                        <g className="qard-map-lesson" transform={`translate(${w - 2},2)`}>
                          <title>Lesson in progress</title>
                          <circle r={9} />
                          <path d="M-2.5,-4 L4,0 L-2.5,4 Z" />
                        </g>
                      )
                    )}
                  </g>
                );
              })}
        </g>
      </svg>
      <div className="qard-map-tools is-left">
        {grouped && !atTopics && (
          <>
            <button className="qard-text-button qard-map-back" onClick={() => enter(undefined)}>
              <ChevronLeft size={15} />
              Topics
            </button>
            <span className="qard-map-crumb">{current?.name}</span>
            <span className="qard-map-divider" />
          </>
        )}
        <label className="qard-map-search">
          <Search size={14} />
          <input
            ref={search}
            type="search"
            aria-label="Find an objective"
            placeholder="Find…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) open(matches[0], true);
            }}
          />
        </label>
        {q && <span className="qard-muted qard-small">{matches.length} found</span>}
      </div>
      <div className="qard-map-tools is-right">
        <button className="qard-icon-button" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
          <Minus size={15} />
        </button>
        <span className="qard-map-zoom">{Math.round(view.k * 100)}%</span>
        <button className="qard-icon-button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          <Plus size={15} />
        </button>
        <button className="qard-icon-button" aria-label="Fit" onClick={() => frame()}>
          <Scan size={15} />
        </button>
        <button
          className="qard-icon-button"
          aria-label={expanded ? 'Exit full screen' : 'Full screen'}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
      {chosen && !atTopics && (
        <aside className="qard-map-panel" aria-label={chosen.title}>
          <div className="qard-map-panel-head">
            <StateChip state={chosen.state} />
            <button className="qard-icon-button" aria-label="Close" onClick={() => open(undefined)}>
              <X size={15} />
            </button>
          </div>
          <h3>{md(chosen.title)}</h3>
          <p className="qard-muted qard-small">
            {[chosen.group, status(chosen)].filter(Boolean).join(' · ')}
          </p>
          <div className="qard-map-panel-actions">
            {inProgress.has(chosen.id) && actions.openLesson ? (
              <button
                className="qard-primary"
                onClick={() => actions.openLesson!(inProgress.get(chosen.id)!)}
              >
                Continue lesson
              </button>
            ) : (
              <button
                className={
                  UNTAUGHT.includes(chosen.state) && chosen.state !== 'planned'
                    ? 'qard-primary'
                    : ''
                }
                onClick={() => actions.teach(chosen)}
              >
                Teach
              </button>
            )}
            {actions.check && !UNTAUGHT.includes(chosen.state) && (
              <button disabled={actions.busy?.(chosen.id)} onClick={() => actions.check!(chosen)}>
                {actions.busy?.(chosen.id) ? 'Writing…' : 'Check'}
              </button>
            )}
            {chosen.needs.length > 0 && (
              <button
                className={route ? 'is-on' : ''}
                aria-pressed={!!route}
                onClick={() => {
                  if (route) {
                    setRoute(undefined);
                    return;
                  }
                  const next = routeTo(course, chosen.id);
                  setRoute(next);
                  frame(
                    [...next, chosen.id].filter((id) => layout.nodes.has(id)),
                    true,
                    true,
                  );
                }}
              >
                <Route size={14} />
                Route here
              </button>
            )}
          </div>
          {route && (
            <section>
              <div className="qard-label">
                Route · {route.length ? `${route.length} to learn` : 'nothing left to learn'}
              </div>
              {route.length ? (
                <div className="qard-map-route">
                  {route.map((id, i) => (
                    <button key={id} className="qard-map-link" onClick={() => open(id, true)}>
                      <span className="qard-map-route-n">{i + 1}</span>
                      <i className={cls(byId.get(id)?.state ?? 'new')} />
                      {md(titleOf(id))}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="qard-muted qard-small">Everything this builds on has been taught.</p>
              )}
              {route[0] && route[0] !== chosen.id && (
                <button
                  className="qard-primary"
                  onClick={() => actions.teach(byId.get(route[0]!)!)}
                >
                  Teach step 1
                </button>
              )}
            </section>
          )}
          {chosen.needs.length > 0 && (
            <section>
              <div className="qard-label">Builds on</div>
              {links(chosen.needs)}
            </section>
          )}
          {(allDependents.get(chosen.id)?.length ?? 0) > 0 && (
            <section>
              <div className="qard-label">Unlocks</div>
              {links(allDependents.get(chosen.id)!)}
            </section>
          )}
          {actions.openLesson && lessons.some((l) => l.objective === chosen.id) && (
            <section>
              <div className="qard-label">Lessons</div>
              {lessons
                .filter((l) => l.objective === chosen.id)
                .map((l) => (
                  <button
                    key={l.path}
                    className="qard-map-link"
                    onClick={() => actions.openLesson!(l.path)}
                  >
                    <span>{new Date(l.created).toLocaleDateString()}</span>
                    <small className="qard-muted">{l.finished ? '✓ done' : 'in progress'}</small>
                  </button>
                ))}
            </section>
          )}
          {chosen.notes.length > 0 && (
            <section>
              <div className="qard-label">Notes</div>
              {chosen.notes.map((n) => (
                <button
                  key={n}
                  className="qard-link qard-map-note"
                  onClick={() => actions.openNote(n)}
                >
                  {n}
                </button>
              ))}
            </section>
          )}
          <section>
            <div className="qard-label">Evidence</div>
            {chosen.evidence.length ? (
              [...chosen.evidence].reverse().map((e, i) => (
                <p key={i} className="qard-small qard-map-evidence">
                  {e}
                </p>
              ))
            ) : (
              <p className="qard-muted qard-small">None yet.</p>
            )}
          </section>
        </aside>
      )}
    </div>
  );
}

/** Counts per state as one stacked bar. Legend entries filter the map. */
export function CourseProgress({
  course,
  filter,
  toggle,
}: {
  course: Mastery;
  filter?: Set<string>;
  toggle?: (key: string) => void;
}) {
  const counts = ORDER.map(
    (s) => [s, course.objectives.filter((o) => o.state === s).length] as const,
  ).filter(([, n]) => n > 0);
  const total = course.objectives.length || 1,
    ready = readyToLearn(course).size;
  const chip = (key: string, label: string, className: string) =>
    toggle ? (
      <button
        key={key}
        className={className + (filter?.has(key) ? ' is-on' : '')}
        aria-pressed={!!filter?.has(key)}
        onClick={() => toggle(key)}
      >
        <i />
        {label}
      </button>
    ) : (
      <span key={key} className={className}>
        <i />
        {label}
      </span>
    );
  return (
    <div className="qard-progress">
      <div
        className="qard-progress-bar"
        role="img"
        aria-label={counts.map(([s, n]) => `${n} ${STATE_LABEL[s].toLowerCase()}`).join(', ')}
      >
        {counts.map(([s, n]) => (
          <span key={s} className={cls(s)} style={{ flexGrow: n / total }} />
        ))}
      </div>
      <div className="qard-progress-legend">
        {counts.map(([s, n]) => chip(s, `${n} ${STATE_LABEL[s].toLowerCase()}`, cls(s)))}
        {ready > 0 && chip('ready', `${ready} ready to learn`, 'is-ready')}
        {filter?.size ? (
          <button className="qard-link" onClick={() => [...filter].forEach((k) => toggle?.(k))}>
            Show all
          </button>
        ) : null}
      </div>
    </div>
  );
}
