import { wombCode } from './depth-cases';

// Controlled compiler fixtures: none of these are taken from an editor or a workspace project.
export const javaTraceCases = [
  { id: 'original', code: wombCode },
  { id: 'additional-allocation', code: wombCode.replace('x.show();', 'B y = new B(); x.show();') },
  {
    id: 'reordered-classes',
    code:
      wombCode.slice(0, wombCode.indexOf('    static class A')) +
      wombCode.slice(
        wombCode.indexOf('    static class B'),
        wombCode.indexOf('    public static void main'),
      ) +
      wombCode.slice(
        wombCode.indexOf('    static class A'),
        wombCode.indexOf('    static class B'),
      ) +
      wombCode.slice(wombCode.indexOf('    public static void main')),
  },
  {
    id: 'inherited-method',
    code: wombCode.replace(
      '@Override void show() { System.out.print(s + n + super.s + super.n + " "); }',
      '',
    ),
  },
  {
    id: 'renamed',
    code: wombCode
      .replace(/\bA\b/g, 'Parent')
      .replace(/\bB\b/g, 'Child')
      .replace(/\bs\b/g, 'label')
      .replace(/\bn\b/g, 'count')
      .replace(/\bshow\b/g, 'display')
      .replace(/\bwho\b/g, 'kind')
      .replace(/\bx\b/g, 'item'),
  },
  {
    id: 'different-values',
    code: wombCode
      .replace('int n = 1', 'int n = 4')
      .replace('int n = 2', 'int n = 5')
      .replace('n += 10', 'n -= 2')
      .replace('n *= 3', 'n *= 4')
      .replace('n += 100', 'n += 30'),
  },
  {
    id: 'declarations-below-constructor',
    code: wombCode.replace(
      'String s = "B";\n        int n = 2;\n        { n *= 3; }\n        B() { super(); show(); n += 100; }',
      'B() { super(); show(); n += 100; }\n        String s = "B";\n        int n = 2;\n        { n *= 3; }',
    ),
  },
  { id: 'implicit-super', code: wombCode.replace('B() { super();', 'B() {') },
  { id: 'no-annotation', code: wombCode.replace('@Override ', '') },
  { id: 'child-reference', code: wombCode.replace('A x = new B()', 'B x = new B()') },
  {
    id: 'numeric-prefix',
    code: wombCode.replace('x.s + x.n + ((B) x).s', 'x.n + ((B) x).n + x.s + ((B) x).s'),
  },
  {
    id: 'int-overflow',
    code: wombCode.replace('int n = 1', 'int n = 2147483647').replace('n *= 3', 'n *= 2147483647'),
  },
  { id: 'no-child-field', code: wombCode.replace('String s = "B";', '') },
  { id: 'default-string', code: wombCode.replace('String s = "B";', 'String s;') },
  { id: 'super-call', code: wombCode.replace('super(); show();', 'super(); super.show();') },
  { id: 'null-static-result', code: wombCode.replace('return "a"', 'return null') },
  { id: 'class-static-call', code: wombCode.replace('x.who()', 'B.who()') },
  { id: 'parent-cast', code: wombCode.replace('((B) x).n', '((A) x).n') },
  {
    id: 'comments-and-escapes',
    code: wombCode.replace(
      'String s = "B";',
      '/* } fake constructor */ String s = "B\\\"\\t"; // {\n',
    ),
  },
  {
    id: 'qualified-assignment',
    code: wombCode.replace('{ n *= 3; }', '{ this.n *= 3; super.n += 2; }'),
  },
  { id: 'constant-initializer', code: wombCode.replace('int n = 2;', 'int n = -(2 + 3) * 4;') },
  { id: 'empty-constructor', code: wombCode.replace('B() { super(); show(); n += 100; }', '') },
  { id: 'string-assignment', code: wombCode.replace('{ n *= 3; }', '{ s += n; n *= 3; }') },
  { id: 'base-object', code: wombCode.replace('class A {', 'class A extends Object {') },
  { id: 'all-public-methods', code: wombCode.replaceAll('void show()', 'public void show()') },
];
