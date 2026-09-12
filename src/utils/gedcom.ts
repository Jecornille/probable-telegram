import type { Person, Sex } from '../types';

interface GedcomLine {
  level: number;
  xref?: string;
  tag: string;
  value?: string;
}

function parseLines(text: string): GedcomLine[] {
  // Strip a UTF-8 BOM some GEDCOM exporters add, and normalize line endings.
  const clean = text.replace(/^﻿/, '');
  const rawLines = clean.split(/\r\n|\r|\n/);
  const lines: GedcomLine[] = [];

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    const withXref = line.match(/^0\s+@([^@]+)@\s+(\S+)\s*$/);
    if (withXref) {
      lines.push({ level: 0, xref: withXref[1], tag: withXref[2] });
      continue;
    }

    const generic = line.match(/^(\d+)\s+(\S+)(?:\s+(.*))?$/);
    if (!generic) continue;
    lines.push({ level: Number(generic[1]), tag: generic[2], value: generic[3] });
  }

  return lines;
}

function parseName(raw: string): { firstName: string; lastName: string } {
  const match = raw.match(/^([^/]*)\/([^/]*)\/?/);
  if (match) {
    return { firstName: match[1].trim(), lastName: match[2].trim() };
  }
  const trimmed = raw.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, lastSpace).trim(), lastName: trimmed.slice(lastSpace + 1).trim() };
}

function extractYear(dateValue: string | undefined): number | undefined {
  if (!dateValue) return undefined;
  const match = dateValue.match(/\b(\d{3,4})\b/);
  return match ? Number(match[1]) : undefined;
}

function sexFromGedcom(value: string | undefined): Sex {
  if (value === 'M') return 'M';
  if (value === 'F') return 'F';
  return 'X';
}

interface RawIndi {
  id: string;
  firstName: string;
  lastName: string;
  sex: Sex;
  birthYear?: number;
  deathYear?: number;
  birthPlace?: string;
  famsIds: string[];
  famcId?: string;
}

interface RawFam {
  id: string;
  husbandId?: string;
  wifeId?: string;
  childIds: string[];
}

/** Parses GEDCOM (.ged) text into this app's Person records. */
export function parseGedcom(text: string): Person[] {
  const lines = parseLines(text);
  const indis = new Map<string, RawIndi>();
  const fams = new Map<string, RawFam>();

  let currentIndi: RawIndi | null = null;
  let currentFam: RawFam | null = null;
  let currentEvent: 'BIRT' | 'DEAT' | null = null;

  for (const line of lines) {
    if (line.level === 0) {
      currentEvent = null;
      if (line.xref && line.tag === 'INDI') {
        currentIndi = { id: line.xref, firstName: '', lastName: '', sex: 'X', famsIds: [] };
        indis.set(line.xref, currentIndi);
        currentFam = null;
      } else if (line.xref && line.tag === 'FAM') {
        currentFam = { id: line.xref, childIds: [] };
        fams.set(line.xref, currentFam);
        currentIndi = null;
      } else {
        currentIndi = null;
        currentFam = null;
      }
      continue;
    }

    if (line.level === 1) {
      currentEvent = line.tag === 'BIRT' || line.tag === 'DEAT' ? line.tag : null;

      if (currentIndi) {
        switch (line.tag) {
          case 'NAME': {
            const { firstName, lastName } = parseName(line.value ?? '');
            currentIndi.firstName = firstName;
            currentIndi.lastName = lastName;
            break;
          }
          case 'SEX':
            currentIndi.sex = sexFromGedcom(line.value);
            break;
          case 'FAMS': {
            const id = line.value?.replace(/@/g, '');
            if (id) currentIndi.famsIds.push(id);
            break;
          }
          case 'FAMC': {
            if (!currentIndi.famcId) currentIndi.famcId = line.value?.replace(/@/g, '');
            break;
          }
        }
      } else if (currentFam) {
        switch (line.tag) {
          case 'HUSB':
            currentFam.husbandId = line.value?.replace(/@/g, '');
            break;
          case 'WIFE':
            currentFam.wifeId = line.value?.replace(/@/g, '');
            break;
          case 'CHIL': {
            const id = line.value?.replace(/@/g, '');
            if (id) currentFam.childIds.push(id);
            break;
          }
        }
      }
      continue;
    }

    if (line.level === 2 && currentIndi && currentEvent) {
      if (line.tag === 'DATE') {
        const year = extractYear(line.value);
        if (currentEvent === 'BIRT') currentIndi.birthYear = year;
        else currentIndi.deathYear = year;
      } else if (line.tag === 'PLAC' && currentEvent === 'BIRT') {
        currentIndi.birthPlace = line.value?.trim() || undefined;
      }
    }
  }

  const people: Person[] = [];
  for (const indi of indis.values()) {
    const parentIds: string[] = [];
    if (indi.famcId) {
      const fam = fams.get(indi.famcId);
      if (fam) {
        if (fam.husbandId && indis.has(fam.husbandId)) parentIds.push(fam.husbandId);
        if (fam.wifeId && indis.has(fam.wifeId)) parentIds.push(fam.wifeId);
      }
    }

    const partnerIds: string[] = [];
    for (const famsId of indi.famsIds) {
      const fam = fams.get(famsId);
      if (!fam) continue;
      const spouseId = fam.husbandId === indi.id ? fam.wifeId : fam.wifeId === indi.id ? fam.husbandId : undefined;
      if (spouseId && indis.has(spouseId) && !partnerIds.includes(spouseId)) partnerIds.push(spouseId);
    }

    people.push({
      id: indi.id,
      firstName: indi.firstName || '?',
      lastName: indi.lastName || '?',
      sex: indi.sex,
      birthYear: indi.birthYear,
      deathYear: indi.deathYear,
      birthPlace: indi.birthPlace,
      parentIds,
      partnerIds,
    });
  }

  return people;
}
