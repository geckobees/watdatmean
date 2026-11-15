const example = (id: string, body: string, expected: string, helpers = '') => ({
  id,
  main: 'Demo',
  expected,
  code: `import java.util.*; import java.util.stream.*; import java.util.function.*; public class Demo { ${helpers} public static void main(String[] args) { ${body} } }`,
});
// Independent expectations, checked against compiled Java 17 as well as both editor adapters.
export const javaMethodOptionalCases = [
  example(
    'optional-empty-bound-null-ref',
    'String s=null; try { Optional.<String>empty().map(s::concat); } catch(NullPointerException e) { System.out.println("reference creation first"); }',
    'reference creation first\n',
  ),
  example(
    'optional-empty-lambda-not-called',
    'String s=null; System.out.println(Optional.<String>empty().map(x -> s.concat(x)).isEmpty());',
    'true\n',
  ),
  example(
    'optional-filter-null-empty',
    'try { Optional.empty().filter(null); } catch(NullPointerException e) { System.out.println("predicate required"); }',
    'predicate required\n',
  ),
  example(
    'optional-or-null-present',
    'try { Optional.of("x").or(null); } catch(NullPointerException e) { System.out.println("supplier required"); }',
    'supplier required\n',
  ),
  example(
    'optional-orElseGet-null-empty',
    'try { Optional.empty().orElseGet(null); } catch(NullPointerException e) { System.out.println("supplier called"); }',
    'supplier called\n',
  ),
  example(
    'optional-flatmap-empty',
    'Optional<String> a=Optional.<String>empty().flatMap(s -> null); System.out.println(a.isEmpty());',
    'true\n',
  ),
  example(
    'optionalint-empty-get',
    'try { OptionalInt.empty().getAsInt(); } catch(NoSuchElementException e) { System.out.println("missing int"); }',
    'missing int\n',
  ),
  example(
    'reference-trim-not-unicode-strip',
    'System.out.println(Optional.of(" x ").map(String::trim).get().length());',
    '3\n',
  ),
  example(
    'reference-parse-overflow',
    'try { Optional.of("2147483648").map(Integer::parseInt); } catch(NumberFormatException e) { System.out.println("outside int"); }',
    'outside int\n',
  ),
  example(
    'reference-toString-null',
    'Function<Object,String> f=String::valueOf; System.out.println(f.apply(null));',
    'null\n',
  ),
  example(
    'reference-unbound-override',
    'ToIntFunction<B> f=A::get; System.out.println(f.applyAsInt(new B()));',
    '2\n',
    'static class A { int get(){return 1;} } static class B extends A { @Override int get(){return 2;} }',
  ),
  example(
    'reference-void-discards-result',
    'IntConsumer f=Demo::value; f.accept(3);',
    '3\n',
    'static int value(int n){System.out.println(n); return n+1;}',
  ),
  example(
    'reference-static-sum',
    'System.out.println(IntStream.of(2,3,4).reduce(0,Integer::sum));',
    '9\n',
  ),
  example(
    'reference-unbound-length',
    'System.out.println(Stream.of("a","code","hi").mapToInt(String::length).sum());',
    '7\n',
  ),
  example('reference-print', 'IntStream.of(2,4).forEach(System.out::println);', '2\n4\n'),
  example(
    'reference-bound-equals',
    'String wanted="cat"; System.out.println(Stream.of("cat","dog","cat").filter(wanted::equals).count());',
    '2\n',
  ),
  example(
    'reference-bound-reassigned',
    'String prefix="old"; Function<String,String> f=prefix::concat; prefix="new"; System.out.println(f.apply("!"));',
    'old!\n',
  ),
  example(
    'reference-bound-null-now',
    'String s=null; try { Supplier<Integer> f=s::length; System.out.println("not reached"); } catch(NullPointerException e) { System.out.println("creation failed"); }',
    'creation failed\n',
  ),
  example(
    'reference-unbound-null-later',
    'ToIntFunction<String> f=String::length; System.out.println("created"); try { f.applyAsInt(null); } catch(NullPointerException e) { System.out.println("call failed"); }',
    'created\ncall failed\n',
  ),
  example(
    'reference-parse',
    'System.out.println(Stream.of("12","-2","+3").mapToInt(Integer::parseInt).sum());',
    '13\n',
  ),
  example(
    'reference-invalid-parse',
    'try { Stream.of("2","bad").mapToInt(Integer::parseInt).sum(); } catch(NumberFormatException e) { System.out.println("invalid number"); }',
    'invalid number\n',
  ),
  example(
    'reference-overloaded-valueof',
    'Function<String,Integer> parse=Integer::valueOf; IntFunction<Integer> box=Integer::valueOf; System.out.println(parse.apply("12")+box.apply(3));',
    '15\n',
  ),
  example(
    'reference-string-valueof',
    'System.out.println(IntStream.of(1,2).mapToObj(String::valueOf).toList());',
    '[1, 2]\n',
  ),
  example(
    'reference-unboxing',
    'System.out.println(Stream.of(2,4).mapToInt(Integer::intValue).sum());',
    '6\n',
  ),
  example(
    'reference-helper',
    'System.out.println(IntStream.of(2,3).map(Demo::twice).sum());',
    '10\n',
    'static int twice(int n) { return n*2; }',
  ),
  example(
    'reference-helper-overload',
    'IntUnaryOperator f=Demo::pick; System.out.println(f.applyAsInt(3));',
    '4\n',
    'static int pick(int n) { return n+1; } static int pick(Integer n) { return n+10; }',
  ),
  example(
    'reference-constructor-later',
    'Supplier<Box> factory=Box::new; System.out.println("saved"); Box b=factory.get(); System.out.println(b.n);',
    'saved\nconstruct\n3\n',
    'static class Box { int n=3; Box(){System.out.println("construct");} }',
  ),
  example(
    'reference-constructor-argument',
    'IntFunction<Box> factory=Box::new; Box b=factory.apply(7); System.out.println(b.n);',
    '7\n',
    'static class Box { int n=0; Box(int value){n=value;} }',
  ),
  example(
    'reference-virtual-dispatch',
    'A a=new B(); IntSupplier f=a::get; System.out.println(f.getAsInt());',
    '2\n',
    'static class A { int get(){return 1;} } static class B extends A { @Override int get(){return 2;} }',
  ),
  example(
    'reference-bound-object-state',
    'Box a=new Box(); IntSupplier f=a::get; a.n=9; a=new Box(); System.out.println(f.getAsInt());',
    '9\n',
    'static class Box { int n=1; int get(){return n;} }',
  ),
  example(
    'reference-string-constructor',
    'Supplier<String> f=String::new; System.out.println(f.get().length());',
    '0\n',
  ),
  example(
    'reference-count-elision',
    'System.out.println(Stream.of("bad").map(Integer::parseInt).count());',
    '1\n',
  ),
  example(
    'optional-present-empty',
    'Optional<String> a=Optional.of("Ada"); Optional<String> b=Optional.empty(); System.out.println(a.isPresent()); System.out.println(b.isEmpty()); System.out.println(a.get());',
    'true\ntrue\nAda\n',
  ),
  example(
    'optional-nullable',
    'String name=null; Optional<String> a=Optional.ofNullable(name); System.out.println(a.orElse("Guest"));',
    'Guest\n',
  ),
  example(
    'optional-of-null',
    'try { Optional<String> a=Optional.of(null); } catch(NullPointerException e) { System.out.println("null rejected"); }',
    'null rejected\n',
  ),
  example(
    'optional-null-reference',
    'Optional<String> a=null; try { a.isEmpty(); } catch(NullPointerException e) { System.out.println("not an empty Optional"); }',
    'not an empty Optional\n',
  ),
  example(
    'optional-eager-lazy',
    'Optional<String> a=Optional.of("saved"); System.out.println(a.orElse(fallback())); System.out.println(a.orElseGet(Demo::fallback)); Optional<String> b=Optional.empty(); System.out.println(b.orElseGet(Demo::fallback));',
    'fallback\nsaved\nsaved\nfallback\nnew\n',
    'static String fallback(){System.out.println("fallback"); return "new";}',
  ),
  example(
    'optional-map-filter',
    'System.out.println(Optional.of(" Ada ").map(String::trim).filter(s -> s.length()>2).orElse("Guest"));',
    'Ada\n',
  ),
  example(
    'optional-map-length',
    'System.out.println(Optional.of("code").map(String::length).orElse(0));',
    '4\n',
  ),
  example(
    'optional-map-null',
    'Optional<String> a=Optional.of("x"); Optional<String> b=a.map(s -> null); System.out.println(b.isEmpty());',
    'true\n',
  ),
  example(
    'optional-flatmap',
    'Optional<String> a=Optional.of("x").flatMap(s -> Optional.of(s+"!")); System.out.println(a.get());',
    'x!\n',
  ),
  example(
    'optional-flatmap-reference',
    'System.out.println(Optional.of("x").flatMap(Optional::of).get());',
    'x\n',
  ),
  example(
    'optional-flatmap-null',
    'try { Optional<String> a=Optional.of("x").flatMap(s -> null); } catch(NullPointerException e) { System.out.println("must return Optional"); }',
    'must return Optional\n',
  ),
  example(
    'optional-empty-map-skipped',
    'Optional<String> a=Optional.empty(); System.out.println(a.map(Integer::parseInt).orElse(7));',
    '7\n',
  ),
  example(
    'optional-null-mapper-checked',
    'Optional<String> a=Optional.empty(); Function<String,String> f=null; try { a.map(f); } catch(NullPointerException e) { System.out.println("mapper required"); }',
    'mapper required\n',
  ),
  example(
    'optional-actions',
    'Optional.of("yes").ifPresent(System.out::println); Optional.<String>empty().ifPresentOrElse(System.out::println, () -> System.out.println("empty"));',
    'yes\nempty\n',
  ),
  example(
    'optional-unused-null-actions',
    'Optional.<String>empty().ifPresent(null); Optional.of("yes").ifPresentOrElse(System.out::println,null); System.out.println(Optional.of("x").orElseGet(null));',
    'yes\nx\n',
  ),
  example(
    'optional-selected-null-action',
    'try { Optional.<String>empty().ifPresentOrElse(null,null); } catch(NullPointerException e) { System.out.println("empty action required"); }',
    'empty action required\n',
  ),
  example(
    'optional-or',
    'Optional<String> a=Optional.empty(); System.out.println(a.or(() -> Optional.of("backup")).get());',
    'backup\n',
  ),
  example(
    'optional-or-skipped',
    'System.out.println(Optional.of("x").or(Demo::fallback).get());',
    'x\n',
    'static Optional<String> fallback(){System.out.println("wrong"); return Optional.of("y");}',
  ),
  example(
    'optional-or-null-result',
    'try { Optional.<String>empty().or(() -> null); } catch(NullPointerException e) { System.out.println("Optional required"); }',
    'Optional required\n',
  ),
  example(
    'optional-empty-get',
    'try { Optional.empty().get(); } catch(NoSuchElementException e) { System.out.println("missing"); }',
    'missing\n',
  ),
  example(
    'optional-throw-default',
    'try { Optional.empty().orElseThrow(); } catch(NoSuchElementException e) { System.out.println("missing"); }',
    'missing\n',
  ),
  example(
    'optional-throw-constructor',
    'try { Optional.<String>empty().orElseThrow(IllegalStateException::new); } catch(IllegalStateException e) { System.out.println("missing"); }',
    'missing\n',
  ),
  example(
    'optional-throw-checked',
    'try { Optional.<String>empty().orElseThrow(Exception::new); } catch(Exception e) { System.out.println("checked"); }',
    'checked\n',
  ),
  example(
    'optional-throw-unused',
    'System.out.println(Optional.of("x").orElseThrow(IllegalStateException::new));',
    'x\n',
  ),
  example(
    'optional-stream-fresh',
    'Optional<String> a=Optional.of("hello"); System.out.println(a.stream().mapToInt(String::length).sum()); System.out.println(a.stream().count()); System.out.println(Optional.<String>empty().stream().count());',
    '5\n1\n0\n',
  ),
  example(
    'optional-equality',
    'System.out.println(Optional.of(3).equals(Optional.of(3))); System.out.println(Optional.empty().equals(Optional.empty())); System.out.println(Optional.of("3").equals(Optional.of(3)));',
    'true\ntrue\nfalse\n',
  ),
  example(
    'optionalint',
    'OptionalInt a=OptionalInt.of(8); System.out.println(a.getAsInt()); System.out.println(OptionalInt.empty().orElseGet(() -> 4)); a.ifPresent(System.out::println);',
    '8\n4\n8\n',
  ),
  example(
    'optionalint-stream',
    'System.out.println(OptionalInt.of(3).stream().map(n -> n*2).sum()); System.out.println(OptionalInt.empty().stream().count());',
    '6\n0\n',
  ),
  example(
    'stream-findfirst',
    'System.out.println(Stream.of("a","long","last").filter(s -> s.length()>2).findFirst().orElse("none")); System.out.println(IntStream.empty().findFirst().orElse(9));',
    'long\n9\n',
  ),
  example(
    'stream-findfirst-null',
    'String a=null; try { Stream.of(a,"x").findFirst(); } catch(NullPointerException e) { System.out.println("null first item"); }',
    'null first item\n',
  ),
  example(
    'stream-min-max',
    'System.out.println(IntStream.of(7,2,9).min().getAsInt()); System.out.println(IntStream.of(7,2,9).max().orElse(0)); System.out.println(IntStream.empty().min().isEmpty());',
    '2\n9\ntrue\n',
  ),
  example(
    'stream-reduce-optional',
    'System.out.println(Stream.of(2,3,4).reduce(Integer::sum).orElse(0)); System.out.println(IntStream.empty().reduce(Integer::sum).isEmpty()); System.out.println(IntStream.of(5).reduce(Integer::sum).getAsInt());',
    '9\ntrue\n5\n',
  ),
];
