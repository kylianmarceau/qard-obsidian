import { localDay, type ExamPlan } from './exam-plan';

export const examTone = (id: string) =>
  Array.from(id).reduce((hash, letter) => (hash * 31 + letter.codePointAt(0)!) >>> 0, 0) % 6;
export const dayDistance = (from: string, to: string) => {
  const utc = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
};
export function examMonth(plans: ExamPlan[], today: string): string {
  const dates = plans.map((plan) => plan.date).sort();
  return (dates.find((date) => date >= today) ?? dates[dates.length - 1] ?? today).slice(0, 7);
}
export function shiftMonth(month: string, amount: number): string {
  const date = new Date(`${month}-01T12:00:00`);
  date.setMonth(date.getMonth() + amount);
  return localDay(date).slice(0, 7);
}
/** Monday-first calendar with complete weeks, using local noon across DST changes. */
export function monthDays(month: string): string[] {
  const first = new Date(`${month}-01T12:00:00`),
    last = new Date(first);
  last.setMonth(last.getMonth() + 1, 0);
  const offset = (first.getDay() + 6) % 7;
  const length = Math.ceil((offset + last.getDate()) / 7) * 7;
  return Array.from({ length }, (_, i) => {
    const day = new Date(first);
    day.setDate(i - offset + 1);
    return localDay(day);
  });
}
/** Revision days show the saved routine, not a prediction of future review queues. */
export function plansOnDay(plans: ExamPlan[], day: string) {
  const weekday = new Date(`${day}T12:00:00`).getDay();
  return {
    exams: plans.filter((plan) => plan.date === day),
    revision: plans.filter(
      (plan) =>
        day >= localDay(plan.createdAt) && day <= plan.date && plan.weekdays.includes(weekday),
    ),
  };
}
