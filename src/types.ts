export type Sex = 'F' | 'M' | 'X';

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  /** Name at birth, when different from the current last name (e.g. before marriage). */
  birthName?: string;
  sex: Sex;
  birthYear?: number;
  deathYear?: number;
  birthPlace?: string;
  notes?: string;
  /** Up to two parent ids. */
  parentIds: string[];
  /** Partner/spouse ids (mutual). */
  partnerIds: string[];
  /** Manual nudge from the automatically computed position, in pixels — set by dragging the node. */
  offsetX?: number;
  offsetY?: number;
}

export interface PositionedPerson extends Person {
  generation: number;
  slot: number;
  x: number;
  y: number;
}
