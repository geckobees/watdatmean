// Independent examples, not transformations of Womb. Expected output is also checked by javac/java.
export const javaGeneralCases = [
  {
    id: 'literal-crlf-preserved',
    main: 'LiteralLines',
    expected: 'a\r\nb!\n',
    code: `public class LiteralLines { public static void main(String[] args) { System.out.print("a\\r\\nb"); System.out.println("!"); } }`,
  },
  {
    id: 'overflow-division',
    main: 'Overflow',
    expected: '-2147483648:0\n',
    code: `public class Overflow { public static void main(String[] args) { int n = 2147483647 + 1; System.out.println(n / -1 + ":" + n % -1); } }`,
  },
  {
    id: 'local-receipt',
    main: 'Receipt',
    expected: 'Total: 21\n',
    code: `public class Receipt {
    public static void main(String[] args) { int price = 7; int count = 3; int total = price * count; System.out.println("Total: " + total); }
  }`,
  },
  {
    id: 'static-helper',
    main: 'Pricing',
    expected: '24\n',
    code: `public class Pricing {
    static int total(int price, int count) { return price * count; }
    public static void main(String[] args) { int amount = total(8, 3); System.out.println(amount); }
  }`,
  },
  {
    id: 'parameter-shadowing',
    main: 'Ticket',
    expected: '12\n',
    code: `public class Ticket {
    int price = 2;
    Ticket(int price) { this.price = price; }
    int cost(int count) { return price * count; }
    public static void main(String[] args) { Ticket ticket = new Ticket(4); System.out.println(ticket.cost(3)); }
  }`,
  },
  {
    id: 'two-independent-objects',
    main: 'Counter',
    expected: '5:9\n',
    code: `public class Counter {
    int value; Counter(int start) { value = start; }
    void add(int amount) { value += amount; }
    public static void main(String[] args) { Counter first = new Counter(2); Counter second = new Counter(9); first.add(3); System.out.println(first.value + ":" + second.value); }
  }`,
  },
  {
    id: 'reference-alias',
    main: 'Box',
    expected: '7:7\n',
    code: `public class Box {
    int size = 1;
    public static void main(String[] args) { Box original = new Box(); Box alias = original; alias.size = 7; System.out.println(original.size + ":" + alias.size); }
  }`,
  },
  {
    id: 'top-level-inheritance',
    main: 'AnimalDemo',
    expected: 'woof:animal:dog\n',
    code: `class Animal { String kind = "animal"; String sound() { return "?"; } }
    class Dog extends Animal { String kind = "dog"; @Override String sound() { return "woof"; } }
    public class AnimalDemo { public static void main(String[] args) { Animal pet = new Dog(); System.out.println(pet.sound() + ":" + pet.kind + ":" + ((Dog) pet).kind); } }`,
  },
  {
    id: 'three-level-construction',
    main: 'OrderDemo',
    expected: 'root 0 root 0 root 5 \n',
    code: `class Root {
      int number = 1; Root() { show(); number += 1; }
      void show() { System.out.print("root "); }
    }
    class Middle extends Root { int number = 2; Middle() { show(); } }
    class Leaf extends Middle { int number = 3; { number += 2; } @Override void show() { super.show(); System.out.print(number + " "); } }
    public class OrderDemo { public static void main(String[] args) { Root root = new Leaf(); root.show(); System.out.println(""); } }`,
  },
  {
    id: 'super-arguments',
    main: 'Child',
    expected: '5:10\n',
    code: `class Parent { int value; Parent(int value) { this.value = value; } }
    public class Child extends Parent { int value = 10; Child(int start) { super(start + 1); }
      public static void main(String[] args) { Child item = new Child(4); System.out.println(((Parent) item).value + ":" + item.value); } }`,
  },
  {
    id: 'instance-return-and-mutation',
    main: 'Account',
    expected: '15:15\n',
    code: `public class Account {
    int balance = 10;
    int deposit(int amount) { balance += amount; return balance; }
    public static void main(String[] args) { Account account = new Account(); int result = account.deposit(5); System.out.println(result + ":" + account.balance); }
  }`,
  },
  {
    id: 'local-shadows-field',
    main: 'Score',
    expected: '10:3\n',
    code: `public class Score {
    int value = 3;
    void show() { int value = 10; System.out.println(value + ":" + this.value); }
    public static void main(String[] args) { Score score = new Score(); score.show(); }
  }`,
  },
  {
    id: 'mutating-argument-order',
    main: 'Sequence',
    expected: '1,2,:12\n',
    code: `public class Sequence {
    int n;
    int next() { n += 1; System.out.print(n + ","); return n; }
    static int join(int first, int second) { return first * 10 + second; }
    public static void main(String[] args) { Sequence seq = new Sequence(); int result = join(seq.next(), seq.next()); System.out.println(":" + result); }
  }`,
  },
  {
    id: 'compound-before-side-effect',
    main: 'Count',
    expected: '7\n',
    code: `public class Count {
    int n = 2;
    int change() { n = 10; return 5; }
    public static void main(String[] args) { Count count = new Count(); count.n += count.change(); System.out.println(count.n); }
  }`,
  },
  {
    id: 'string-method',
    main: 'Greeting',
    expected: 'Hello Ada\n',
    code: `public class Greeting {
    static String greet(String name) { return "Hello " + name; }
    public static void main(String[] args) { System.out.println(greet("Ada")); }
  }`,
  },
  {
    id: 'integer-division',
    main: 'Sharing',
    expected: '-2:-1\n',
    code: `public class Sharing {
    public static void main(String[] args) { int total = -7; int people = 3; System.out.println(total / people + ":" + total % people); }
  }`,
  },
  {
    id: 'mixed-numeric-string',
    main: 'Joining',
    expected: '5 items 23\n',
    code: `public class Joining { public static void main(String[] args) { System.out.println(2 + 3 + " items " + 2 + 3); } }`,
  },
  {
    id: 'object-type-reassignment',
    main: 'Dispatch',
    expected: 'basechild\n',
    code: `class BaseVoice { String say() { return "base"; } }
    class ChildVoice extends BaseVoice { String say() { return "child"; } }
    public class Dispatch { public static void main(String[] args) { BaseVoice voice = new BaseVoice(); System.out.print(voice.say()); voice = new ChildVoice(); System.out.println(voice.say()); } }`,
  },
  {
    id: 'static-hidden-null',
    main: 'StaticDemo',
    expected: 'parent:child:parent\n',
    code: `class ParentName { static String name() { return "parent"; } }
    class ChildName extends ParentName { static String name() { return "child"; } }
    public class StaticDemo { public static void main(String[] args) { ParentName item = new ChildName(); ParentName empty = null; System.out.println(item.name() + ":" + ChildName.name() + ":" + empty.name()); } }`,
  },
  {
    id: 'parent-allocation',
    main: 'Parents',
    expected: '2\n',
    code: `class Common { int n = 2; } class Derived extends Common { int n = 9; }
    public class Parents { public static void main(String[] args) { Common item = new Common(); System.out.println(item.n); } }`,
  },
  {
    id: 'nested-single-helper',
    main: 'BadgeDemo',
    expected: 'ID:8\n',
    code: `public class BadgeDemo {
    static class Badge { int id; Badge(int id) { this.id = id; } String label() { return "ID:" + id; } }
    public static void main(String[] args) { Badge badge = new Badge(8); System.out.println(badge.label()); }
  }`,
  },
  {
    id: 'initializer-versus-parameter',
    main: 'Setup',
    expected: '4\n',
    code: `public class Setup {
    int n = 2; { n *= 3; } Setup(int n) { this.n = n; }
    public static void main(String[] args) { Setup setup = new Setup(4); System.out.println(setup.n); }
  }`,
  },
  {
    id: 'no-output',
    main: 'Silent',
    expected: '',
    code: `public class Silent { public static void main(String[] args) { int total = 2 + 3; total *= 2; } }`,
  },
  {
    id: 'null-string',
    main: 'NullText',
    expected: 'null!\n',
    code: `public class NullText { static String text() { return null; } public static void main(String[] args) { String value = text(); System.out.println(value + "!"); } }`,
  },
  {
    id: 'unused-return-helper',
    main: 'Unused',
    expected: 'done\n',
    code: `public class Unused { static int divide(int n) { return 1 / n; } public static void main(String[] args) { System.out.println("done"); } }`,
  },
  {
    id: 'cr-line-comment',
    main: 'Lines',
    expected: 'ok\n',
    code: 'public class Lines { // comment\r public static void main(String[] args) { System.out.println("ok"); } }',
  },
  {
    id: 'bare-return',
    main: 'Finished',
    expected: 'done\n',
    code: `public class Finished { public static void main(String[] args) { System.out.println("done"); return; } }`,
  },
  {
    id: 'static-through-new',
    main: 'StaticOrder',
    expected: 'init ok\n',
    code: `public class StaticOrder { StaticOrder() { System.out.print("init "); } static String word() { return "ok"; } public static void main(String[] args) { System.out.println(new StaticOrder().word()); } }`,
  },
];
