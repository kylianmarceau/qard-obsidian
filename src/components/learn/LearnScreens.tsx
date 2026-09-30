import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronRight, FileText, Folder, Plus } from 'lucide-react';
import { TFolder } from 'obsidian';
import type { QardServices } from '../../views/services';
import type { Mastery, Objective } from '../../learn/mastery';
import { CourseMap, CourseProgress } from './CourseMap';
import { NEEDS_LESSON, isoDay } from '../../learn/mastery';
import type { LessonSummary, Today, TodayItem } from '../../learn/learn-types';
import { Check, JobError, Waiting } from '../tests/common';
import { LibraryTabs } from '../tests/TestsBrowser';
import type { TestNav } from '../tests/common';
import { StateChip, relativeDay, useLearn, type LearnNav } from './common';
import { WhileYouWait, useHold } from '../jobs/WhileYouWait';

/** Loads Today and reloads it whenever the learn service changes. */
function useToday(services: QardServices) {
  const { revision } = useLearn(services);
  const [today, setToday] = useState<Today>();
  useEffect(() => { let live = true; services.learn.todayList().then(t => { if (live) setToday(t); }, () => {}); return () => { live = false; }; }, [services, revision]);
  return today;
}
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/** Opens a lesson for an objective that needs teaching. */
/** Opens a lesson for an objective: the unfinished one if there is one, otherwise a new lesson. */
export async function teach(services: QardServices, nav: LearnNav, item: { mastery: string; objective: string; title: string }) {
  const open = (await services.learn.listLessons()).find(l => !l.finished && l.mastery === item.mastery && l.objective === item.objective);
  nav.lesson(open?.path ?? await services.learn.startLesson({ topic: item.title, notes: [], mastery: item.mastery, objective: item.objective }));
}

/** The home-page summary: what is due today, one click to start. */
export function TodayRow({ services, nav }: { services: QardServices; nav: LearnNav }) {
  const today = useToday(services);
  if (!today || (!today.checks.length && !today.lessons.length && !today.cards)) return null;
  const parts = [today.checks.length && plural(today.checks.length, 'check'), today.cards && plural(today.cards, 'card'), today.lessons.length && plural(today.lessons.length, 'lesson')].filter(Boolean);
  return <button className="qard-resume qard-today-row" onClick={nav.today}><strong>Today</strong><span className="qard-muted">{parts.join(' · ')}</span><ChevronRight size={16}/></button>;
}

export function TodayView({ services, nav }: { services: QardServices; nav: LearnNav }) {
  const today = useToday(services), { job } = useLearn(services), [error, setError] = useState('');
  useEffect(() => { if (today) services.learn.prepare(today); }, [services, today]);
  if (!today) return <Waiting text="Loading…"/>;
  const minutes = Math.max(1, Math.round(today.checks.length * 2 + today.cards / 6));
  const first = today.checks.find(c => c.check);
  const start = () => first ? nav.check(first.check!) : today.cards ? nav.studyDue() : undefined;
  const nothing = !today.checks.length && !today.cards && !today.lessons.length;
  const open = (item: TodayItem) => item.check ? nav.check(item.check) : undefined;
  return <div className="qard-doc">
    <header><h1>Today</h1><p className="qard-muted">{nothing ? 'Nothing is due. Map a course or make a test to keep going.' : `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. Checks first, then cards.`}</p></header>
    {today.checks.length > 0 && <section><h2>Checks</h2>{today.checks.map(c => { const writing = job(`${c.mastery}#${c.objective}`, 'check-write'); return <div key={c.mastery + c.objective}>
      <button className="qard-doc-row qard-row-button" disabled={!c.check} onClick={() => open(c)}><span>{c.title}</span><span className="qard-muted">{c.course}</span><StateChip state={c.state}/>{c.check ? <ChevronRight size={15}/> : <span className="qard-muted">{writing?.error ? '' : 'Writing…'}</span>}</button>
      <JobError job={writing} retry={() => void services.learn.ensureCheck(c.mastery, c.objective)}/>
    </div>; })}</section>}
    {today.cards > 0 && <section><h2>Cards</h2><button className="qard-doc-row qard-row-button" onClick={nav.studyDue}><span>{plural(today.cards, 'card')} due for review</span><ChevronRight size={15}/></button></section>}
    {today.lessons.length > 0 && <section><h2>Lessons</h2><p className="qard-muted qard-small">Optional. These objectives need teaching before they can be checked.</p>{today.lessons.map(l => <button key={l.mastery + l.objective} className="qard-doc-row qard-row-button" onClick={() => void teach(services, nav, l).catch(e => setError((e as Error).message))}><span>{l.title}</span><span className="qard-muted">{l.course}</span><StateChip state={l.state}/><span className="qard-link">Teach</span></button>)}{today.moreLessons > 0 && <button className="qard-doc-row qard-row-button" onClick={() => nav.course(today.lessons[0]!.mastery)}><span className="qard-muted">{plural(today.moreLessons, 'more objective')} to teach</span><ChevronRight size={15}/></button>}</section>}
    {error && <p className="qard-error" role="alert">{error}</p>}
    {(first || today.cards > 0) && <div className="qard-doc-footer is-end"><button className="qard-primary" onClick={start}>Start<ArrowRight size={15}/></button></div>}
  </div>;
}

export function LearnBrowser({ services, nav, testNav }: { services: QardServices; nav: LearnNav; testNav: TestNav }) {
  const { revision } = useLearn(services);
  const [courses, setCourses] = useState<Mastery[]>(), [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof services.learn.pending>>>();
  useEffect(() => { let live = true; void Promise.all([services.learn.courses(), services.learn.listLessons(), services.learn.pending()]).then(([c, l, p]) => { if (live) { setCourses(c); setLessons(l); setPending(p); } }, () => { if (live) setCourses([]); }); return () => { live = false; }; }, [services, revision]);
  const day = isoDay(Date.now());
  const open = lessons.filter(l => !l.finished), recent = lessons.filter(l => l.finished).slice(0, 5);
  return <>
    <div className="qard-heading"><LibraryTabs active="learn" decks={testNav.library} tests={testNav.tests} learn={nav.learn}/><div className="qard-actions"><button onClick={nav.today}>Today</button><button className="qard-primary" onClick={() => nav.mapCourse()}><Plus size={16}/>Map a course</button></div></div>
    {!courses && <p className="qard-muted" role="status">Loading courses…</p>}
    {pending?.mapping.map(f => <div key={f} className="qard-resume is-static"><Waiting text={`Mapping ${f.split('/').pop()}…`}/></div>)}
    {pending?.failed.map(f => <div key={f.kind + f.target} className="qard-error" role="alert"><span>{f.kind === 'map' ? 'Mapping' : 'Updating'} {f.target.split('/').pop()!.replace(/\.md$/, '')} failed: {f.error}</span>
      <button className="qard-text-button" onClick={() => void (f.kind === 'map' ? services.learn.mapCourse(f.target, f.request) : services.learn.updateCourse(f.target, f.request))}>Try again</button>
      <button className="qard-text-button" onClick={() => void services.learn.dismissFailure(f.kind, f.target)}>Dismiss</button></div>)}
    {pending?.proposals.map(p => <button key={p.folder} className="qard-resume" onClick={() => nav.mapCourse(p.folder)}><span className="qard-muted">Ready to review</span><strong>{p.course} · {plural(p.objectives.length, 'objective')}</strong><ChevronRight size={16}/></button>)}
    {pending?.updates.map(u => <button key={u.mastery} className="qard-resume" onClick={() => nav.course(u.mastery)}><span className="qard-muted">Update ready</span><strong>{u.course}</strong><ChevronRight size={16}/></button>)}
    {open.map(l => <button key={l.path} className="qard-resume" onClick={() => nav.lesson(l.path)}><span className="qard-muted">Continue lesson</span><strong>{l.title}</strong>{l.course && <span className="qard-muted">{l.course}</span>}<ChevronRight size={16}/></button>)}
    <div className="qard-deck-list">{courses?.map(c => {
      const mastered = c.objectives.filter(o => o.state === 'mastered').length, due = c.objectives.filter(o => o.state !== 'new' && o.due && o.due <= day).length;
      return <button key={c.path} className="qard-deck qard-test-row" onClick={() => nav.course(c.path)}>
        <span className="qard-deck-name"><strong>{c.course}</strong><small>{mastered} of {plural(c.objectives.length, 'objective')} mastered</small></span>
        <span className="qard-test-status">{due ? `${due} due` : ''}</span><ChevronRight size={17}/>
      </button>;
    })}</div>
    {courses && !courses.length && <div className="qard-empty"><p>No courses yet.</p><p className="qard-muted">Map a course folder into objectives. Qard keeps one mastery file per course and uses it to choose what to teach, check and test.</p><button onClick={() => nav.mapCourse()}>Map a course</button></div>}
    {recent.length > 0 && <section className="qard-learn-recent"><div className="qard-label">Recent lessons</div>{recent.map(l => <button key={l.path} className="qard-doc-row qard-row-button" onClick={() => nav.lesson(l.path)}><FileText size={14}/><span>{l.title}</span><span className="qard-muted">{new Date(l.created).toLocaleDateString()}</span></button>)}</section>}
  </>;
}

export function MapCourse({ services, nav, initialFolder }: { services: QardServices; nav: LearnNav; initialFolder?: string }) {
  const { job } = useLearn(services);
  const [folder, setFolder] = useState<string | undefined>(initialFolder), [query, setQuery] = useState(''), [request, setRequest] = useState('');
  const hold = useHold();
  const [keep, setKeep] = useState<string[]>(), [error, setError] = useState('');
  const folders = useMemo(() => {
    const q = query.toLowerCase().trim();
    return services.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && !!f.path && f.path !== '/' && !f.path.split('/').some(p => p.startsWith('.')) && (!q || f.path.toLowerCase().includes(q))).map(f => f.path).sort().slice(0, 8);
  }, [services, query]);
  const mapping = folder ? job(folder, 'map-course') : undefined, proposal = folder ? services.learn.proposal(folder) : undefined;
  useEffect(() => { if (proposal && !keep) setKeep(proposal.objectives.map(o => o.id)); }, [proposal, keep]);
  if (folder && ((mapping && !mapping.error) || hold.held)) return <WhileYouWait services={services} title={`Mapping ${folder.split('/').pop()}…`} detail="The writer is reading the course notes; the objectives wait under Learn for you to review." job={mapping}
    ready={!!proposal} readyLabel="The objectives are ready to review" onEngage={hold.engage} onContinue={hold.release} context={{ kind: 'mapping' }}/>;
  if (folder && proposal && keep) return <article className="qard-doc">
    <header><span className="qard-muted">Proposed objectives</span><h1>{proposal.course}</h1><p className="qard-muted">{proposal.objectives.length} objectives from {folder}. Untick any you don't need; you can edit the file later.</p></header>
    <section>{proposal.objectives.map(o => <button key={o.id} className="qard-doc-row qard-row-button" aria-pressed={keep.includes(o.id)} onClick={() => setKeep(keep.includes(o.id) ? keep.filter(x => x !== o.id) : [...keep, o.id])}><Check on={keep.includes(o.id)}/><span>{o.title}</span><span className="qard-muted">{o.notes.slice(0, 2).join(', ')}</span><StateChip state={o.state}/></button>)}</section>
    {error && <p className="qard-error" role="alert">{error}</p>}
    <div className="qard-doc-footer is-end"><button className="qard-text-button" onClick={() => { void services.learn.discardProposal(folder); setKeep(undefined); }}>Start over</button><button className="qard-primary" disabled={!keep.length} onClick={() => void services.learn.acceptCourse(folder, keep).then(nav.course, e => setError((e as Error).message))}>Create mastery file<ArrowRight size={15}/></button></div>
  </article>;
  return <div className="qard-new-test">
    <h1>Which folder holds the course?</h1>
    <div className="qard-composer">
      {folder ? <span className="qard-chip is-on"><Folder size={13}/>{folder}<button className="qard-chip-x" aria-label="Choose another folder" onClick={() => setFolder(undefined)}>×</button></span>
        : <><input type="search" aria-label="Find a folder" placeholder="Find a folder…" value={query} onChange={e => setQuery(e.target.value)}/>
          <div className="qard-folder-list">{folders.map(f => <button key={f} className="qard-popover-item" onClick={() => setFolder(f)}><Folder size={14}/><span>{f}</span></button>)}{!folders.length && <p className="qard-muted">No matching folders.</p>}</div></>}
      {folder && <textarea aria-label="Anything to add" rows={2} placeholder="Optional, e.g. focus on the A1 syllabus" value={request} onChange={e => setRequest(e.target.value)}/>}
      <div className="qard-composer-bar"><span className="qard-muted qard-small">The writer lists the objectives it finds. Nothing is saved until you accept.</span><button className="qard-primary" disabled={!folder} onClick={() => { setKeep(undefined); void services.learn.mapCourse(folder!, request); }}>Map course<ArrowRight size={15}/></button></div>
    </div>
    {folder && <JobError job={mapping} retry={() => void services.learn.mapCourse(folder, request)}/>}
  </div>;
}

export function CourseView({ services, nav, path, objective }: { services: QardServices; nav: LearnNav; path: string; objective?: string }) {
  const { revision, job } = useLearn(services);
  const [course, setCourse] = useState<Mastery>(), [error, setError] = useState(''), [busy, setBusy] = useState<string>();
  const [view, setView] = useState<'map' | 'list'>('map'), [filter, setFilter] = useState<Set<string>>(new Set()), [updating, setUpdating] = useState(false);
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  useEffect(() => { let live = true; services.learn.course(path).then(c => { if (live) setCourse(c); }, e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [services, path, revision]);
  useEffect(() => { let live = true; services.learn.listLessons().then(l => { if (live) setLessons(l.filter(x => x.mastery === path)); }, () => {}); return () => { live = false; }; }, [services, path, revision]);
  if (error && !course) return <p className="qard-error" role="alert">{error}</p>;
  if (!course) return <Waiting text="Loading…"/>;
  if (updating || services.learn.update(path) || job(path, 'map-course')) return <UpdateCourse services={services} course={course} done={() => setUpdating(false)}/>;
  const day = isoDay(Date.now()), changed = services.learn.changedNotes(course);
  async function check(id: string) {
    setBusy(id); setError('');
    try { const found = await services.learn.ensureCheck(path, id); if (found) nav.check(found); else setError(services.learn.job(`${path}#${id}`, 'check-write')?.error ?? 'Could not write a check.'); }
    finally { setBusy(undefined); }
  }
  const actions = (o: Objective) => {
    const writing = job(`${path}#${o.id}`, 'check-write'), lesson = NEEDS_LESSON.includes(o.state) || o.state === 'planned';
    return <span className="qard-objective-actions">
      <button className={lesson && o.state !== 'planned' ? 'qard-primary' : ''} onClick={() => void teach(services, nav, { mastery: path, objective: o.id, title: o.title }).catch(e => setError((e as Error).message))}>Teach</button>
      {!lesson && <button disabled={busy === o.id || (!!writing && !writing.error)} onClick={() => void check(o.id)}>{busy === o.id || (writing && !writing.error) ? 'Writing…' : 'Check'}</button>}
    </span>;
  };
    const toggle = (key: string) => setFilter(f => { const next = new Set(f); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const mapActions = { openLesson: (p: string) => nav.lesson(p), teach: (o: Objective) => void teach(services, nav, { mastery: path, objective: o.id, title: o.title }).catch(e => setError((e as Error).message)), check: (o: Objective) => void check(o.id), openNote: (n: string) => void services.app.workspace.openLinkText(n, path, true), busy: (id: string) => busy === id || (!!job(`${path}#${id}`, 'check-write') && !job(`${path}#${id}`, 'check-write')?.error) };
  return <article className="qard-course">
    <header className="qard-course-head">
      <div><span className="qard-muted">Course</span><h1>{course.course}</h1></div>
      <div className="qard-actions">
        <div className="qard-segmented" role="tablist"><button role="tab" aria-selected={view === 'map'} onClick={() => setView('map')}>Map</button><button role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>List</button></div>
        <button onClick={() => setUpdating(true)}>Update objectives</button>
        <button className="qard-text-button" onClick={() => void services.app.workspace.openLinkText(path, '', true)}>Open file</button>
      </div>
    </header>
    <CourseProgress course={course} filter={filter} toggle={toggle}/>
    {changed.length > 0 && <button className="qard-resume" onClick={() => setUpdating(true)}><span>{plural(changed.length, 'note')} added or changed since {course.mapped!.slice(0, 10)}</span><span className="qard-muted">Update objectives</span><ChevronRight size={16}/></button>}
    {error && <p className="qard-error" role="alert">{error}</p>}
    {view === 'map' ? <CourseMap course={course} actions={mapActions} filter={filter} today={day} lessons={lessons} initial={objective}/>
      : <section>{course.objectives.filter(o => !filter.size || filter.has(o.state)).map(o => <div key={o.id} className="qard-objective">
      <div className="qard-objective-main"><strong>{o.title}</strong><small className="qard-muted">{o.evidence.at(-1) ?? 'No evidence yet'}</small></div>
      <StateChip state={o.state}/>
      <span className="qard-muted qard-objective-due">{o.due && !['new', 'planned'].includes(o.state) ? relativeDay(o.due, day) : ''}</span>
      {actions(o)}
    </div>)}</section>}
    {!course.objectives.length && <p className="qard-muted">This mastery file has no objectives table. Open it and add rows, or update the objectives.</p>}
  </article>;
}

/** Proposes objectives from notes added since the last mapping; only the ticked parts are applied. */
function UpdateCourse({ services, course, done }: { services: QardServices; course: Mastery; done: () => void }) {
  const { job } = useLearn(services);
  const path = course.path, running = job(path, 'map-course'), update = services.learn.update(path);
  const [request, setRequest] = useState(''), [error, setError] = useState('');
  const hold = useHold();
  const [added, setAdded] = useState<string[]>(), [extended, setExtended] = useState<string[]>(), [remove, setRemove] = useState<string[]>([]);
  useEffect(() => { if (update && !added) { setAdded(update.added.map(o => o.id)); setExtended(update.extended.map(e => e.id)); } }, [update, added]);
  const changed = services.learn.changedNotes(course);
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  if ((running && !running.error) || hold.held) return <WhileYouWait services={services} title={`Reading ${course.course}'s notes…`} detail="The writer is looking for new objectives; existing ones and your progress stay as they are." job={running}
    ready={!!update} readyLabel="The update is ready to review" onEngage={hold.engage} onContinue={hold.release} context={{ kind: 'mapping' }}/>;
  if (update && added && extended) {
    const nothing = !update.added.length && !update.extended.length && !update.outdated.length;
    return <article className="qard-doc">
      <header><span className="qard-muted">Update objectives</span><h1>{course.course}</h1><p className="qard-muted">From {plural(update.notes.length, 'note')}: {update.notes.map(n => n.split('/').pop()!.replace(/\.md$/, '')).join(', ')}</p></header>
      {nothing && <p>Nothing new to add. The objectives already cover these notes.</p>}
      {update.added.length > 0 && <section><h2>New objectives</h2>{update.added.map(o => <button key={o.id} className="qard-doc-row qard-row-button" aria-pressed={added.includes(o.id)} onClick={() => toggle(added, setAdded, o.id)}><Check on={added.includes(o.id)}/><span>{o.title}</span><span className="qard-muted">{o.notes.slice(0, 2).join(', ')}</span><StateChip state={o.state}/></button>)}</section>}
      {update.extended.length > 0 && <section><h2>More material for existing objectives</h2>{update.extended.map(e => <button key={e.id} className="qard-doc-row qard-row-button" aria-pressed={extended.includes(e.id)} onClick={() => toggle(extended, setExtended, e.id)}><Check on={extended.includes(e.id)}/><span>{e.title}</span><span className="qard-muted">{[...e.notes.map(n => `+ ${n}`), ...e.needs.map(n => `builds on ${n}`), ...(e.group ? [`group: ${e.group}`] : []), ...(e.label ? [`label: ${e.label}`] : [])].join(' · ')}</span></button>)}</section>}
      {update.outdated.length > 0 && <section><h2>Possibly outdated</h2><p className="qard-muted qard-small">Tick to remove. Unticked objectives are kept.</p>{update.outdated.map(o => <button key={o.id} className="qard-doc-row qard-row-button" aria-pressed={remove.includes(o.id)} onClick={() => toggle(remove, setRemove, o.id)}><Check on={remove.includes(o.id)}/><span>{o.title}</span><span className="qard-muted">{o.reason}</span></button>)}</section>}
      {error && <p className="qard-error" role="alert">{error}</p>}
      <div className="qard-doc-footer is-end"><button className="qard-text-button" onClick={() => { void services.learn.discardUpdate(path); setAdded(undefined); done(); }}>Cancel</button>
        <button className="qard-primary" onClick={() => void services.learn.acceptUpdate(path, { added, extended, remove }).then(() => { setAdded(undefined); done(); }, e => setError((e as Error).message))}>{nothing ? 'Mark as up to date' : 'Update mastery file'}<ArrowRight size={15}/></button></div>
    </article>;
  }
  return <div className="qard-new-test">
    <h1>Update {course.course}</h1>
    <div className="qard-composer">
      <p className="qard-muted">{changed.length ? `${plural(changed.length, 'note')} added or changed since the last update: ${changed.map(n => n.split('/').pop()!.replace(/\.md$/, '')).join(', ')}.` : 'The writer will reread the course notes and suggest objectives that are missing.'}</p>
      <textarea aria-label="Anything to add" rows={2} placeholder="Optional, e.g. week 6 covered Hadoop" value={request} onChange={e => setRequest(e.target.value)}/>
      <div className="qard-composer-bar"><button className="qard-text-button" onClick={done}>Cancel</button><button className="qard-primary" onClick={() => void services.learn.updateCourse(path, request)}>Find new objectives<ArrowRight size={15}/></button></div>
    </div>
    <JobError job={running} retry={() => void services.learn.updateCourse(path, request)}/>
  </div>;
}
