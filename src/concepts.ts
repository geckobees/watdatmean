import type { Lesson } from './types';

// These general definitions stay local and never add tokens to an AI request.
const definitions: Record<string, string> = {
  new: 'The new keyword calls a constructor to create and initialize an object.',
  object: 'A value that groups related data as named properties and can also hold methods.',
  class: 'A definition used to create objects with shared behavior and their own data.',
  constructor: 'The setup code that runs when you create an object with new.',
  instance: 'An individual object created from a class.',
  variable:
    'A name that refers to a value; for an object, that value is a reference to the object.',
  function: 'Reusable code that runs when called, optionally taking inputs and returning a result.',
  method: 'A function accessed through an object or class.',
  property: 'A named value belonging to an object.',
  argument: 'A value supplied to a function or constructor when you call it.',
  parameter:
    'A name in a function definition that receives an argument when the function is called.',
  type: 'A description of which values and operations TypeScript allows.',
  compiler: 'A program that checks TypeScript and translates it into JavaScript before it runs.',
  reference: 'A value that lets your code access an existing object without copying it.',
  array: 'An ordered collection of values, accessed by positions starting at zero.',
  const:
    'Declares a name that cannot be reassigned; properties of an object it refers to can still change.',
  let: 'Declares a variable that can be reassigned and is available within its enclosing block.',
};

function includesTerm(text: string, term: string): boolean {
  const source = text.toLowerCase();
  const word = (character: string | undefined) => !!character && /[\p{L}\p{N}_$]/u.test(character);
  let index = source.indexOf(term);
  while (index >= 0) {
    if (!word(source[index - 1]) && !word(source[index + term.length])) return true;
    index = source.indexOf(term, index + 1);
  }
  return false;
}

export function completeConcepts(lesson: Lesson): Lesson['concepts'] {
  const concepts: Lesson['concepts'] = [];
  const seen = new Set<string>();
  for (const concept of lesson.concepts) {
    // Models sometimes format the term as `new` or "new" rather than plain new.
    const term = concept.term
      .trim()
      .replace(/^[`'"“”‘’]+|[`'"“”‘’]+$/g, '')
      .trim();
    const key = term.toLowerCase();
    const fallback = Object.hasOwn(definitions, key) ? definitions[key] : '';
    const explanation = concept.explanation.trim() || fallback;
    if (!term || seen.has(key)) continue;
    concepts.push({ term, explanation });
    seen.add(key);
  }
  const prose = [lesson.summary, ...lesson.steps, lesson.example.explanation];
  for (const [term, explanation] of Object.entries(definitions)) {
    if (seen.has(term) || !prose.some((text) => includesTerm(text, term))) continue;
    concepts.push({ term, explanation });
  }
  return concepts;
}
