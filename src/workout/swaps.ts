// Which exercises may replace one in a started session. Only reviewed, published alternatives of that exercise,
// usable with the equipment where the session happens, and not already in the session. With none, the list is
// empty and the member simply keeps the exercise: there is always a way to carry on.
import { CatalogueInput, Equipment, ExerciseVersion, publishedCatalogue } from './catalogue';
import { usableEquipment } from './sessionChoice';

export interface Availability {
  location: 'home' | 'gym'; // where the session happens
  equipment: Equipment; // what the member has
}

export function eligibleSwaps(exercise: ExerciseVersion, availability: Availability, catalogue: CatalogueInput, exclude: string[] = []): ExerciseVersion[] {
  const offered = publishedCatalogue(catalogue).exercises;
  const current = offered.find((e) => e.id === exercise.id);
  if (!current) return [];
  const usable = usableEquipment(availability.location, availability.equipment);
  const byId = new Map(offered.map((e) => [e.id, e]));
  return current.alternatives.flatMap((id) => {
    const candidate = byId.get(id);
    return candidate && candidate.id !== current.id && !exclude.includes(id) && usable.includes(candidate.equipment) ? [candidate] : [];
  });
}
