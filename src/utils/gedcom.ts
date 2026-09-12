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
  nameSet: boolean;
  birthName?: string;
  altSurnameCandidate?: string;
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
  let currentEvent: 'BIRT' | 'DEAT' | 'NAME' | null = null;

  for (const line of lines) {
    if (line.level === 0) {
      currentEvent = null;
      if (line.xref && line.tag === 'INDI') {
        currentIndi = { id: line.xref, firstName: '', lastName: '', nameSet: false, sex: 'X', famsIds: [] };
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
      currentEvent = line.tag === 'BIRT' || line.tag === 'DEAT' || line.tag === 'NAME' ? line.tag : null;

      if (currentIndi) {
        switch (line.tag) {
          case 'NAME': {
            const { firstName, lastName } = parseName(line.value ?? '');
            // Only the first NAME record becomes the display name; later ones
            // (e.g. a maiden name) are only kept if marked as such below.
            if (!currentIndi.nameSet) {
              currentIndi.firstName = firstName;
              currentIndi.lastName = lastName;
              currentIndi.nameSet = true;
            } else {
              currentIndi.altSurnameCandidate = lastName || firstName;
            }
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
      if (currentEvent === 'NAME') {
        if (line.tag === 'TYPE' && currentIndi.altSurnameCandidate) {
          const type = (line.value ?? '').toLowerCase();
          if (type.includes('maiden') || type.includes('birth')) {
            currentIndi.birthName = currentIndi.altSurnameCandidate;
          }
        }
      } else if (line.tag === 'DATE') {
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
      birthName: indi.birthName,
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

interface FamRecord {
  key: string;
  parents: string[];
  children: string[];
}

function familyKey(parentIds: string[]): string {
  return [...parentIds].sort().join('|');
}

function escapeLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** Serializes this app's Person records into GEDCOM (.ged) text. */
export function serializeGedcom(people: Person[]): string {
  const byId = new Map(people.map((p) => [p.id, p]));
  const families = new Map<string, FamRecord>();

  const getOrCreateFamily = (parentIds: string[]): FamRecord => {
    const key = familyKey(parentIds);
    let fam = families.get(key);
    if (!fam) {
      fam = { key, parents: parentIds, children: [] };
      families.set(key, fam);
    }
    return fam;
  };

  for (const p of people) {
    if (p.parentIds.length > 0) {
      getOrCreateFamily(p.parentIds).children.push(p.id);
    }
  }

  const seenPairs = new Set<string>();
  for (const p of people) {
    for (const partnerId of p.partnerIds) {
      if (!byId.has(partnerId)) continue;
      const pairKey = familyKey([p.id, partnerId]);
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      getOrCreateFamily([p.id, partnerId]);
    }
  }

  const famIds = new Map<string, string>();
  let famCounter = 1;
  for (const key of families.keys()) famIds.set(key, `F${famCounter++}`);

  const indiIds = new Map<string, string>();
  let indiCounter = 1;
  for (const p of people) indiIds.set(p.id, `I${indiCounter++}`);

  const indiFamsMap = new Map<string, string[]>();
  const indiFamcMap = new Map<string, string>();
  for (const fam of families.values()) {
    const xref = famIds.get(fam.key)!;
    for (const parentId of fam.parents) {
      const list = indiFamsMap.get(parentId) ?? [];
      list.push(xref);
      indiFamsMap.set(parentId, list);
    }
    for (const childId of fam.children) {
      if (!indiFamcMap.has(childId)) indiFamcMap.set(childId, xref);
    }
  }

  const lines: string[] = ['0 HEAD', '1 SOUR ArbreGenealogique', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8'];

  for (const p of people) {
    const xref = indiIds.get(p.id)!;
    lines.push(`0 @${xref}@ INDI`);
    lines.push(`1 NAME ${escapeLine(p.firstName)} /${escapeLine(p.lastName)}/`);
    if (p.birthName && p.birthName !== p.lastName) {
      lines.push(`1 NAME /${escapeLine(p.birthName)}/`);
      lines.push('2 TYPE maiden');
    }
    if (p.sex === 'M' || p.sex === 'F') lines.push(`1 SEX ${p.sex}`);
    if (p.birthYear || p.birthPlace) {
      lines.push('1 BIRT');
      if (p.birthYear) lines.push(`2 DATE ${p.birthYear}`);
      if (p.birthPlace) lines.push(`2 PLAC ${escapeLine(p.birthPlace)}`);
    }
    if (p.deathYear) {
      lines.push('1 DEAT');
      lines.push(`2 DATE ${p.deathYear}`);
    }
    const famc = indiFamcMap.get(p.id);
    if (famc) lines.push(`1 FAMC @${famc}@`);
    for (const fams of indiFamsMap.get(p.id) ?? []) lines.push(`1 FAMS @${fams}@`);
    if (p.notes) {
      const [first, ...rest] = p.notes.split(/\r\n|\r|\n/);
      lines.push(`1 NOTE ${escapeLine(first)}`);
      for (const cont of rest) lines.push(`2 CONT ${escapeLine(cont)}`);
    }
  }

  for (const fam of families.values()) {
    const xref = famIds.get(fam.key)!;
    lines.push(`0 @${xref}@ FAM`);
    const [a, b] = fam.parents;
    const isAWife = a && byId.get(a)?.sex === 'F' && byId.get(b ?? '')?.sex !== 'F';
    const husb = isAWife ? b : a;
    const wife = isAWife ? a : b;
    if (husb) lines.push(`1 HUSB @${indiIds.get(husb)}@`);
    if (wife) lines.push(`1 WIFE @${indiIds.get(wife)}@`);
    for (const childId of fam.children) lines.push(`1 CHIL @${indiIds.get(childId)}@`);
  }

  lines.push('0 TRLR');
  return lines.join('\n');
}
