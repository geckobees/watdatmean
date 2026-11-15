import { reject, type JClass, type JProgram } from './java-trace-parser';
import { genericType } from './java-streams';

export const rawJavaType = (type: string) => genericType(type)?.base ?? type;
export const javaTypeLabel = (type: string) => type.replace(/\$T\d+_([A-Za-z_$][\w$]*)/g, '$1');
export function substituteType(type: string, bindings: Map<string, string>): string {
  if (bindings.has(type)) return bindings.get(type)!;
  if (type.endsWith('[]')) return substituteType(type.slice(0, -2), bindings) + '[]';
  const generic = genericType(type);
  return generic
    ? `${generic.base}<${generic.args.map((t) => substituteType(t, bindings)).join(',')}>`
    : type;
}
// Views substitute signatures only. Bodies keep their original type variables/bindings,
// so Box<String> cannot silently rebind an overload compiled against T's Object bound.
export function javaTypes(program: JProgram) {
  const declared = new Map(program.classes.map((c) => [c.name, c]));
  const variables = new Map(
    program.classes
      .flatMap((c) => [...(c.typeParams ?? []), ...c.methods.flatMap((m) => m.typeParams ?? [])])
      .map((p) => [p.name, p.bound]),
  );
  const views = new Map<string, JClass>();
  function bound(type: string): string {
    const seen = new Set<string>();
    while (variables.has(type)) {
      if (seen.has(type) || seen.size > 8) reject();
      seen.add(type);
      type = variables.get(type)!;
    }
    return type;
  }
  const erase = (type: string): string =>
    type.endsWith('[]') ? erase(type.slice(0, -2)) + '[]' : rawJavaType(bound(type));
  function get(type: string): JClass | undefined {
    type = bound(type);
    const generic = genericType(type),
      base = declared.get(generic?.base ?? type);
    if (!base || !generic) return base;
    if (generic.args.length !== base.typeParams?.length || !generic.args.length) reject();
    if (views.has(type)) return views.get(type);
    if (views.size >= 64) reject();
    const bindings = new Map(base.typeParams.map((p, i) => [p.name, generic.args[i]]));
    const replace = (t: string) => substituteType(t, bindings);
    const params = <T extends { type: string }>(list: T[]) =>
      list.map((p) => ({ ...p, type: replace(p.type) }));
    const view: JClass = {
      ...base,
      name: type,
      rawName: base.name,
      typeParams: [],
      parent: base.parent && replace(base.parent),
      interfaces: base.interfaces?.map(replace),
      fields: params(base.fields),
      params: params(base.params),
      initializers: base.initializers.map((e) =>
        Array.isArray(e) ? e : { ...e, type: replace(e.type) },
      ),
      methods: base.methods.map((m) => ({
        ...m,
        params: params(m.params),
        returns: replace(m.returns),
        typeParams: m.typeParams?.map((p) => ({ ...p, bound: replace(p.bound) })),
      })),
    };
    views.set(type, view);
    return view;
  }
  const classes = { get, has: (type: string) => !!get(type), values: () => declared.values() };
  return { classes, variables, bound, erase, declared };
}
