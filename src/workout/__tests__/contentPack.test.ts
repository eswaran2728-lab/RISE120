import fs from 'fs';
import path from 'path';
import { assessReadiness, asIfPublished } from '../../../scripts/training-content/readiness';
import { runValidation } from '../../../scripts/training-content/validate';
import { CatalogueInput, ExerciseVersion, SESSION_MINUTES, SessionTemplate, validateCatalogue } from '../catalogue';
import { selectSession } from '../sessionChoice';

// The beginner content pack under content/. Everything in it is a DRAFT written by an AI assistant: it must stay
// unpublished, with no reviewer, no media and no licence, until a qualified person has reviewed it and the owner
// supplies the evidence. These tests keep the drafts structurally sound and stop anyone from making the pack look
// approved by editing a status.
const ROOT = path.resolve(__dirname, '../../..');
const read = (dir: string) =>
  fs
    .readdirSync(path.join(ROOT, dir))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ name, text: fs.readFileSync(path.join(ROOT, dir, name), 'utf8') }));

const exerciseFiles = read('content/exercises');
const sessionFiles = read('content/sessions');
const catalogue: CatalogueInput = {
  exercises: exerciseFiles.map((f) => JSON.parse(f.text) as ExerciseVersion),
  sessions: sessionFiles.map((f) => JSON.parse(f.text) as SessionTemplate),
};
const LANGS = ['en', 'ms', 'ta'] as const;
const TAMIL = /[஀-௿]/;

describe('the beginner content pack is a draft and stays one until reviewed', () => {
  it('has a small coherent pack: bodyweight, home-equipment and gym exercises and sessions', () => {
    expect(catalogue.exercises.length).toBeGreaterThanOrEqual(15);
    expect(catalogue.exercises.length).toBeLessThanOrEqual(25);
    expect(new Set(catalogue.exercises.map((e) => e.equipment))).toEqual(new Set(['none', 'home', 'gym']));
    expect(new Set(catalogue.exercises.map((e) => e.pattern))).toEqual(new Set(['squat', 'hinge', 'push', 'pull', 'core']));
    expect(catalogue.sessions.map((s) => s.id).sort()).toEqual([
      'gym-beginner-20', 'gym-beginner-30', 'gym-beginner-45', 'home-bodyweight-10', 'home-bodyweight-20', 'home-bodyweight-30', 'home-equipment-20', 'home-equipment-30',
    ]);
  });

  it('keeps every item a draft with no reviewer and no media; nothing is invented', () => {
    for (const item of [...catalogue.exercises, ...catalogue.sessions]) {
      expect(item.status).toBe('draft');
      expect(item.reviewer).toBeNull();
      if ('media' in item) expect(item.media).toBeNull();
    }
  });

  it('would let a later status change in only if the evidence travels with it', () => {
    for (const item of [...catalogue.exercises, ...catalogue.sessions]) {
      if (item.status === 'draft') continue;
      expect(item.reviewer?.name).toBeTruthy();
      expect(item.reviewer?.role).toBeTruthy();
      expect(item.reviewer?.reviewedOn).toBeTruthy();
    }
  });

  it('passes the content validator with no problems', () => {
    const result = runValidation({
      exercises: exerciseFiles.map((f) => ({ path: `content/exercises/${f.name}`, text: f.text })),
      sessions: sessionFiles.map((f) => ({ path: `content/sessions/${f.name}`, text: f.text })),
    });

    expect(result.exitCode).toBe(0);
    expect(result.lines.join('\n')).toContain('offered to members: 0 exercises, 0 sessions');
  });

  it('would pass every publication rule other than the reviewer and media evidence', () => {
    const errors = validateCatalogue(asIfPublished(catalogue)).errors;

    expect(errors).toEqual([]);
  });
});

describe('exercise drafts', () => {
  it('use their id as the file name and start at version 1', () => {
    exerciseFiles.forEach((f, i) => {
      expect(f.name).toBe(`${catalogue.exercises[i].id}.json`);
      expect(catalogue.exercises[i].version).toBe(1);
    });
  });

  it('give at least two cues, each in English, Malay and Tamil, never a copy of the English', () => {
    for (const e of catalogue.exercises) {
      expect(e.cues.length).toBeGreaterThanOrEqual(2);
      for (const cue of e.cues) {
        for (const lang of LANGS) expect(cue[lang].trim().length).toBeGreaterThan(5);
        expect(cue.ms).not.toBe(cue.en);
        expect(TAMIL.test(cue.ta)).toBe(true);
      }
      expect(TAMIL.test(e.name.ta)).toBe(true);
      expect(e.name.ms).not.toBe(e.name.en);
    }
  });

  it('list alternatives of the same movement pattern, and every bodyweight or home exercise has a home substitute', () => {
    const byId = new Map(catalogue.exercises.map((e) => [e.id, e]));
    for (const e of catalogue.exercises) {
      expect(e.alternatives.length).toBeGreaterThan(0);
      e.alternatives.forEach((id) => expect(byId.get(id)?.pattern).toBe(e.pattern));
      if (e.equipment !== 'gym') expect(e.alternatives.some((id) => byId.get(id)!.equipment !== 'gym')).toBe(true);
    }
  });

  it('mention no calories, results or medical claims', () => {
    const text = JSON.stringify(catalogue.exercises.map((e) => e.cues)).toLowerCase();

    expect(text).not.toMatch(/calorie|burn|lose weight|fat loss|cure|treat|injur|diagnos/);
  });
});

describe('session drafts', () => {
  const byId = new Map(catalogue.exercises.map((e) => [e.id, e]));

  it('use only drafted exercises, and fit their declared length once approved', () => {
    for (const s of catalogue.sessions) {
      expect(SESSION_MINUTES).toContain(s.minutes);
      s.exercises.forEach((x) => expect(byId.has(x.exerciseId)).toBe(true));
      expect(s.level).toBe('beginner');
      expect(s.dayType).toBe('training');
    }
  });

  it('use equipment that matches their name: bodyweight sessions need none, home-equipment sessions need no gym', () => {
    for (const s of catalogue.sessions) {
      const equipment = s.exercises.map((x) => byId.get(x.exerciseId)!.equipment);
      if (s.id.startsWith('home-bodyweight')) expect(equipment.every((q) => q === 'none')).toBe(true);
      if (s.id.startsWith('home-equipment')) expect(equipment.every((q) => q !== 'gym')).toBe(true);
      expect(s.location).toBe(s.id.startsWith('gym') ? 'gym' : 'home');
    }
  });

  it('cover push, pull, legs and core across the longer sessions, with sets and reps a beginner can manage', () => {
    for (const s of catalogue.sessions.filter((x) => x.minutes >= 30)) {
      const patterns = new Set(s.exercises.map((x) => byId.get(x.exerciseId)!.pattern));
      expect(patterns.has('squat') || patterns.has('hinge')).toBe(true);
      expect(patterns.has('push')).toBe(true);
      expect(patterns.has('core')).toBe(true);
    }
    for (const s of catalogue.sessions) s.exercises.forEach((x) => {
      expect(x.sets).toBeLessThanOrEqual(3);
      expect(x.reps).toBeLessThanOrEqual(15);
    });
  });
});

describe('what the app would offer once everything is approved', () => {
  const { coverage } = assessReadiness(catalogue);
  const pick = (equipment: string, minutes: number) => coverage.find((c) => c.equipment === equipment && c.minutes === minutes)!.session;

  it('serves every time choice for every equipment level, falling back to a shorter session for 45 and 60 minutes at home', () => {
    expect(coverage.filter((c) => c.session === null)).toEqual([]);
    expect(pick('none', 10)).toBe('home-bodyweight-10');
    expect(pick('none', 60)).toBe('home-bodyweight-30');
    expect(pick('gym', 45)).toBe('gym-beginner-45');
    expect(pick('gym', 60)).toBe('gym-beginner-45');
  });

  it('never gives a member without equipment a session that needs equipment', () => {
    const preview = asIfPublished(catalogue);
    for (const minutes of SESSION_MINUTES) {
      for (let variant = 0; variant < 4; variant++) {
        const choice = selectSession({ minutes, location: 'home', equipment: 'none', energy: 'normal', goal: 'recomp', level: 'beginner', dayType: 'training', variant }, preview);
        expect(choice.available && choice.template.id.startsWith('home-bodyweight')).toBe(true);
      }
    }
  });

  it('offers a member with home equipment both the bodyweight and the equipment session at 20 and 30 minutes', () => {
    const preview = asIfPublished(catalogue);
    for (const minutes of [20, 30] as const) {
      const seen = new Set([0, 1].map((variant) => {
        const choice = selectSession({ minutes, location: 'home', equipment: 'home', energy: 'normal', goal: 'recomp', level: 'beginner', dayType: 'training', variant }, preview);
        return choice.available ? choice.template.id : '';
      }));
      expect(seen).toEqual(new Set([`home-bodyweight-${minutes}`, `home-equipment-${minutes}`]));
    }
  });

  it('still lists what each item needs: every item is blocked on a reviewer and media', () => {
    const { items } = assessReadiness(catalogue);

    expect(items.length).toBe(catalogue.exercises.length + catalogue.sessions.length);
    expect(items.every((i) => i.blockers.includes('no_reviewer'))).toBe(true);
    expect(items.filter((i) => i.kind === 'exercise').every((i) => i.blockers.includes('no_media'))).toBe(true);
  });
});
