import { supabase } from '../lib/supabase';
import { recentFoods } from './cache';
import { FOOD_COLUMNS, mapFoodRow } from './map';
import type { Food } from './types';

export const SEARCH_PAGE_SIZE = 20;

// Lowercase, collapse spaces and strip Latin diacritics. Tamil vowel signs are combining marks
// too, so only the Latin diacritics block is removed and the text is recomposed.
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function names(food: Food): string[] {
  return [food.name, ...(food.aliases.en ?? []), ...(food.aliases.ms ?? []), ...(food.aliases.ta ?? [])].map(normalizeText);
}

const isMalaysianVerified = (food: Food) => food.verified && food.region === 'MY';

// 0 = exact name or alias, 1 = starts with the query, 2 = contains it.
function relevance(food: Food, query: string): number {
  if (query === '') return 0;
  const all = names(food);
  if (all.some((name) => name === query)) return 0;
  if (all.some((name) => name.startsWith(query))) return 1;
  return 2;
}

// Ranking changes order, not eligibility: every matching food is kept. A matching reviewed
// Malaysian food comes before all other matches. Words of the query must all match the name or an
// approved English, Malay or Tamil alias.
export function rankFoods(query: string, foods: Food[]): Food[] {
  const normalized = normalizeText(query);
  const tokens = normalized === '' ? [] : normalized.split(' ');
  const matches = foods.filter((food) => {
    const haystack = names(food).join(' ');
    return tokens.every((token) => haystack.includes(token));
  });
  return [...matches].sort((a, b) => {
    const tier = Number(!isMalaysianVerified(a)) - Number(!isMalaysianVerified(b));
    if (tier !== 0) return tier;
    const byRelevance = relevance(a, normalized) - relevance(b, normalized);
    if (byRelevance !== 0) return byRelevance;
    return normalized === '' ? 0 : a.name.localeCompare(b.name);
  });
}

export interface SearchResult {
  foods: Food[];
  hasMore: boolean;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

// Own and shared foods, under row-level security (another user's custom food is never returned).
// The server orders verified foods first so a Malaysian match is on the first page.
export async function searchStoredFoods(_userId: string, query: string, page = 0): Promise<SearchResult> {
  const normalized = normalizeText(query);
  let request = supabase.from('foods').select(FOOD_COLUMNS);
  for (const token of normalized === '' ? [] : normalized.split(' ')) {
    request = request.ilike('search_text', `%${escapeLike(token)}%`);
  }
  const from = page * SEARCH_PAGE_SIZE;
  const { data, error } = await request
    .order('verified', { ascending: false })
    .order('name', { ascending: true })
    .range(from, from + SEARCH_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return { foods: rankFoods(query, rows.map(mapFoodRow)), hasMore: rows.length === SEARCH_PAGE_SIZE };
}

export interface FindResult extends SearchResult {
  offline: boolean;
}

// Stored search, falling back to this account's recent foods when the server cannot be reached.
export async function findFoods(userId: string, query: string, page = 0): Promise<FindResult> {
  try {
    return { ...(await searchStoredFoods(userId, query, page)), offline: false };
  } catch {
    return { foods: rankFoods(query, await recentFoods(userId)), hasMore: false, offline: true };
  }
}
