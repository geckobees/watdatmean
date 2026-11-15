import type { LearningRequest, Lesson } from '../../src/types';

export const wombCode = `public class Womb {
    static class A {
        String s = "A";
        int n = 1;
        A() { show(); n += 10; }
        void show() { System.out.print(s + n + " "); }
        static String who() { return "a"; }
    }
    static class B extends A {
        String s = "B";
        int n = 2;
        { n *= 3; }
        B() { super(); show(); n += 100; }
        @Override void show() { System.out.print(s + n + super.s + super.n + " "); }
        static String who() { return "b"; }
    }
    public static void main(String[] args) {
        A x = new B();
        x.show();
        System.out.println(x.s + x.n + ((B) x).s + ((B) x).n + x.who() + ((A) null).who());
    }
}`;
export const wombOutput = 'null0A1 B6A11 B106A11 A11B106aa\n';
export const wombRequest: LearningRequest = {
  code: wombCode,
  language: 'Java',
  task: 'explain',
  audience: 'beginner',
  mode: 'standalone',
};

// A human-reviewed reference for retention/rendering tests, not a canned product response.
export const wombLesson: Lesson = {
  title: 'One object, two sets of fields, three method calls',
  summary:
    'This program builds one B object and stores its reference in x, whose declared type is A. It shows why instance methods, fields, and static methods can choose different parts of the same class family.',
  connections: [
    'Womb groups two static nested classes, A and B. They are not non-static inner classes: neither needs a Womb object. B extends A, meaning B is a subclass of A.',
    'The one B object contains both A.s/A.n and B.s/B.n. The names in B hide the names in A; they do not remove or replace those fields.',
    'B.show overrides A.show. Each ordinary show() call here reaches B.show because the object is a B. Inside B.show, s/n name B fields and super.s/super.n name A fields. super is a way to select superclass members, not a second object.',
    'A and B are user-defined. String and System are from java.lang; System.out is a java.io.PrintStream. print writes text without a newline, while println adds one.',
  ],
  steps: [
    "main starts A x = new B(). First Java gives all four instance fields default values: A.s=null, A.n=0, B.s=null, B.n=0. A variable's declared type does not turn a B object into an A object.",
    'B() calls super(), which enters A(). After Object construction, A\'s field initializers run: A.s becomes "A" and A.n becomes 1. B\'s written initializers have not run yet.',
    'A() calls show(). This still uses B.show, even though the call is inside A\'s constructor. The B fields are still null and 0; the A fields are "A" and 1. String concatenation therefore prints "null0A1 ". The trailing space is part of the output.',
    "Back in A(), n += 10 changes A.n from 1 to 11. The n in this constructor names A's field, not B.n. A() then returns to the construction of B.",
    'B\'s field initializers now set B.s="B" and B.n=2. Its instance initializer block { n *= 3; } runs next, so B.n becomes 6. These initializers run in source order before the rest of B\'s constructor body.',
    'B() continues after super() and calls show(). B.show reads B.s="B", B.n=6, A.s="A", A.n=11. It prints "B6A11 ".',
    'Then n += 100 in B() changes B.n from 6 to 106. Construction finishes and x receives the reference to that B object. A.n is still 11.',
    'main calls x.show(). Instance-method overriding follows the actual B object, so B.show prints "B106A11 ". A.show has not run in any of these three calls.',
    'In println, x.s and x.n select A.s and A.n because x is declared A: "A" and 11. ((B) x).s and ((B) x).n select B.s and B.n: "B" and 106. This cast is valid because the object is a B; it does not create another object.',
    'x.who() calls A.who and returns "a". who is static, so x\'s compile-time type A decides the call. B.who hides A.who; it does not override it. ((A) null).who() also calls A.who and returns "a": this static call does not dereference the null object.',
    'The final + expression starts with a String and joins its values left to right: "A" + 11 + "B" + 106 + "a" + "a" becomes "A11B106aa". println writes that text and a newline after the three earlier print calls.',
  ],
  output: {
    text: wombOutput,
    explanation:
      'The first three chunks each end in one space. The final chunk ends in a newline. This is the result derived from the code; an explanation does not itself execute the program.',
  },
  stepOutput: [
    null,
    null,
    'null0A1 ',
    null,
    null,
    'B6A11 ',
    null,
    'B106A11 ',
    null,
    null,
    'A11B106aa\n',
  ],
  pitfalls: [
    "Calling an overridable method from a constructor can expose fields before their written initializers run. In a real app, a parent constructor might call a child's display method before its label is ready. Prefer a separate setup step after construction, or a private/final helper that cannot dispatch to an unfinished subclass.",
    'Keep three rules separate: instance overrides follow the real object; hidden fields follow the reference type; static methods also follow the reference type. Writing A.who() directly makes the static rule clearer.',
  ],
  concepts: [
    { term: 'constructor', explanation: 'Setup code that runs as part of creating an object.' },
    {
      term: 'polymorphism',
      explanation:
        'For an overridden instance method, the actual object class chooses the method implementation at runtime.',
    },
    {
      term: 'field hiding',
      explanation:
        'Two classes in the same inheritance family declare separate fields with the same name.',
    },
    {
      term: 'static method hiding',
      explanation:
        'A subclass declares a static method matching one in its superclass; the call is selected by the expression type.',
    },
  ],
  example: { code: '', explanation: '' },
  predictions: [],
  checks: [],
};

export const depthCases = [
  { id: 'java-construction-explain', request: wombRequest, expected: wombOutput },
  {
    id: 'java-construction-walkthrough',
    request: { ...wombRequest, task: 'walkthrough' as const },
    expected: wombOutput,
  },
  {
    id: 'java-polymorphism-concept',
    request: { ...wombRequest, task: 'concept' as const, concept: 'polymorphism' },
    expected:
      'Runtime class selects overridden instance methods; fields/static methods differ. Connect x.show and A constructor to B.show.',
  },
  {
    id: 'python-closure-depth',
    request: {
      ...wombRequest,
      language: 'Python',
      task: 'walkthrough' as const,
      code: 'def make():\n    late = []\n    saved = []\n    for n in range(3):\n        late.append(lambda: n)\n        saved.append(lambda n=n: n)\n    return late, saved\nlate, saved = make()\nprint([f() for f in late])\nprint([f() for f in saved])',
    },
    expected:
      '[2, 2, 2]\n[0, 1, 2]\nExplain closures versus default arguments evaluated at function creation.',
  },
];
