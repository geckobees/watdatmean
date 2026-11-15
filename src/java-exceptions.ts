// Modeled Java exceptions are distinct from uncatchable grammar/resource rejections.
export const exceptionParents: Record<string, string | undefined> = {
  Throwable: undefined,
  Exception: 'Throwable',
  RuntimeException: 'Exception',
  ArithmeticException: 'RuntimeException',
  NullPointerException: 'RuntimeException',
  IndexOutOfBoundsException: 'RuntimeException',
  ArrayIndexOutOfBoundsException: 'IndexOutOfBoundsException',
  NegativeArraySizeException: 'RuntimeException',
  ArrayStoreException: 'RuntimeException',
  IllegalArgumentException: 'RuntimeException',
  NumberFormatException: 'IllegalArgumentException',
  NoSuchElementException: 'RuntimeException',
  IllegalStateException: 'RuntimeException',
  ClassCastException: 'RuntimeException',
  UnsupportedOperationException: 'RuntimeException',
};
export const exceptionNames = Object.keys(exceptionParents);
export const isException = (type: string) => Object.hasOwn(exceptionParents, type);
export function exceptionSubtype(from: string, to: string): boolean {
  return from === to || (!!exceptionParents[from] && exceptionSubtype(exceptionParents[from]!, to));
}
export const checkedException = (type: string) =>
  isException(type) && !exceptionSubtype(type, 'RuntimeException');
export type JException = { type: string; message: string | null | undefined; detail?: string };
export class JavaThrown extends Error {
  constructor(readonly exception: JException) {
    super(exception.type);
  }
}
export function javaRaise(type: string, message?: string | null, detail?: string): never {
  throw new JavaThrown({ type, message, detail });
}
