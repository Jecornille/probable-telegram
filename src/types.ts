export type Sex = 'F' | 'M' | 'X';

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  sex: Sex;
  birthYear?: number;
  deathYear?: number;
  birthPlace?: string;
  notes?: string;
  /** Up to two parent ids. */
  parentIds: string[];
  /** Partner/spouse ids (mutual). */
  partnerIds: string[];
}

export interface PositionedPerson extends Person {
  generation: number;
  slot: number;
  x: number;
  y: number;
}
