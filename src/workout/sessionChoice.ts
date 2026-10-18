// Chooses today's session from the reviewed catalogue. Pure and deterministic: the same inputs give the same
// answer, and only published, complete, reviewed templates are ever considered. The rules are deliberately
// conservative:
//  - a rest day stays a rest day (high energy never adds a session);
//  - the session never takes longer than the time the member has;
//  - the level never goes above the member's own;
//  - low energy prefers a reviewed gentle (recovery) session, and high energy is treated like normal energy;
//  - nothing suitable is a plain "unavailable", never a made-up session.
import { CatalogueInput, Equipment, Goal, Level, Minutes, SessionTemplate, publishedCatalogue } from './catalogue';

export type Energy = 'low' | 'normal' | 'high';

export interface SessionChoiceInput {
  minutes: Minutes;
  location: 'home' | 'gym';
  equipment: Equipment; // the member's saved equipment
  energy: Energy;
  goal: Goal;
  level: Level;
  dayType: 'training' | 'rest';
  variant?: number; // rotates between equally suitable sessions (for example the day number)
}

export type SessionChoice =
  | { available: true; template: SessionTemplate; reason: 'fits_time' | 'shorter_to_fit' | 'gentle_for_low_energy' }
  | { available: false; reason: 'rest_day' | 'no_suitable_template' };

const LEVEL_RANK: Record<Level, number> = { beginner: 0, intermediate: 1, advanced: 2 };

// Which exercise equipment classes can be done. At a gym everything; at home only what the member has.
function usableEquipment(location: 'home' | 'gym', equipment: Equipment): Equipment[] {
  if (location === 'gym') return ['gym', 'home', 'none'];
  return equipment === 'none' ? ['none'] : ['home', 'none'];
}

function goalScore(template: SessionTemplate, goal: Goal): number {
  return template.goal === goal ? 2 : template.goal === 'recomp' ? 1 : 0;
}

export function selectSession(input: SessionChoiceInput, catalogue: CatalogueInput): SessionChoice {
  if (input.dayType === 'rest') return { available: false, reason: 'rest_day' };

  const offered = publishedCatalogue(catalogue);
  const exerciseEquipment = new Map(offered.exercises.map((e) => [e.id, e.equipment]));
  const usable = usableEquipment(input.location, input.equipment);

  const candidates = offered.sessions.filter(
    (s) =>
      s.minutes <= input.minutes &&
      LEVEL_RANK[s.level] <= LEVEL_RANK[input.level] &&
      (s.location === 'home' || input.location === 'gym') &&
      s.exercises.every((x) => {
        const equipment = exerciseEquipment.get(x.exerciseId);
        return equipment !== undefined && usable.includes(equipment);
      })
  );

  const gentle = input.energy === 'low' ? candidates.filter((s) => s.dayType === 'recovery') : [];
  const pool = gentle.length > 0 ? gentle : candidates.filter((s) => s.dayType === 'training');
  if (pool.length === 0) return { available: false, reason: 'no_suitable_template' };

  const longest = Math.max(...pool.map((s) => s.minutes));
  const sameLength = pool.filter((s) => s.minutes === longest);
  const score = (s: SessionTemplate) => [LEVEL_RANK[s.level] === LEVEL_RANK[input.level] ? 1 : 0, goalScore(s, input.goal)] as const;
  const best = sameLength.reduce((top, s) => (score(s)[0] * 10 + score(s)[1] > top ? score(s)[0] * 10 + score(s)[1] : top), -1);
  const top = sameLength.filter((s) => score(s)[0] * 10 + score(s)[1] === best).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = Math.abs(Math.trunc(input.variant ?? 0)) % top.length;
  const template = top[index];

  const reason = gentle.length > 0 ? 'gentle_for_low_energy' : template.minutes === input.minutes ? 'fits_time' : 'shorter_to_fit';
  return { available: true, template, reason };
}
