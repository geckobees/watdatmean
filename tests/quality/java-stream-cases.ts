const example = (id: string, body: string, expected: string) => ({
  id,
  main: 'Demo',
  expected,
  code: `import java.util.*; import java.util.stream.*; import java.util.function.*; public class Demo { public static void main(String[] args) { ${body} } }`,
});
// Outputs are independent expectations, also compared with compiled Java 17.
export const javaStreamCases = [
  example(
    'lambda-block-loop',
    'IntUnaryOperator sum=n -> { int total=0; for(int i=0;i<n;i++){total+=i;} return total; }; System.out.println(sum.applyAsInt(5));',
    '10\n',
  ),
  example(
    'stream-large-skip-count',
    'System.out.println(IntStream.range(0,1000000000).skip(999999998).count());',
    '2\n',
  ),
  example(
    'stream-short-circuit-after-map',
    'System.out.println(IntStream.of(2,0).map(n -> 8/n).anyMatch(n -> n==4));',
    'true\n',
  ),
  example(
    'lambda-null-call',
    'IntUnaryOperator f=null; try { f.applyAsInt(2); } catch(NullPointerException e) { System.out.println("null lambda"); }',
    'null lambda\n',
  ),
  example(
    'lambda-final-capture',
    'final int bonus=2; IntUnaryOperator add=n -> n+bonus; System.out.println(add.applyAsInt(3));',
    '5\n',
  ),
  example(
    'stream-count-text',
    'System.out.println("count="+IntStream.of(1,2,3).count());',
    'count=3\n',
  ),
  example(
    'stream-filter-map-sum',
    'int total=IntStream.of(1,2,3,4).filter(n -> n%2==0).map(n -> n*3).sum(); System.out.println(total);',
    '18\n',
  ),
  example(
    'stream-list-map',
    'List<String> names=List.of("Al","Maya","Jo"); List<String> chosen=names.stream().filter(s -> s.length()>2).map(s -> s+"!").toList(); System.out.println(chosen); System.out.println(names);',
    '[Maya!]\n[Al, Maya, Jo]\n',
  ),
  example(
    'stream-boxed-to-int',
    'System.out.println(Stream.of(2,4,6).mapToInt(n -> n+1).sum());',
    '15\n',
  ),
  example(
    'stream-object-to-int',
    'System.out.println(Stream.of("a","code","hi").mapToInt(s -> s.length()).sum());',
    '7\n',
  ),
  example(
    'stream-int-to-object',
    'System.out.println(IntStream.range(1,4).mapToObj(n -> "item"+n).toList());',
    '[item1, item2, item3]\n',
  ),
  example(
    'stream-boxing',
    'System.out.println(IntStream.rangeClosed(2,4).boxed().toList());',
    '[2, 3, 4]\n',
  ),
  example(
    'stream-order',
    'System.out.println(Stream.of(4,1,4,2,3).distinct().sorted().skip(1).limit(2).toList());',
    '[2, 3]\n',
  ),
  example(
    'stream-string-sort',
    'System.out.println(Stream.of("pear","apple","pear","kiwi").distinct().sorted().toList());',
    '[apple, kiwi, pear]\n',
  ),
  example(
    'stream-skip-before-filter',
    'System.out.println(IntStream.rangeClosed(1,6).skip(2).filter(n -> n%2==0).boxed().toList());',
    '[4, 6]\n',
  ),
  example(
    'stream-take-drop',
    'System.out.println(IntStream.of(1,2,5,1).takeWhile(n -> n<4).boxed().toList()); System.out.println(IntStream.of(1,2,5,1).dropWhile(n -> n<4).boxed().toList());',
    '[1, 2]\n[5, 1]\n',
  ),
  example(
    'stream-early-match',
    'System.out.println(IntStream.of(2,0).anyMatch(n -> 6/n==3));',
    'true\n',
  ),
  example(
    'stream-all-match',
    'System.out.println(IntStream.of(2,0).allMatch(n -> 6/n==1));',
    'false\n',
  ),
  example(
    'stream-none-match',
    'System.out.println(IntStream.of(2,0).noneMatch(n -> 6/n==3));',
    'false\n',
  ),
  example(
    'stream-empty-matches',
    'System.out.println(IntStream.empty().anyMatch(n -> n>0)); System.out.println(IntStream.empty().allMatch(n -> n>0)); System.out.println(IntStream.empty().noneMatch(n -> n>0));',
    'false\ntrue\ntrue\n',
  ),
  example(
    'stream-count-elision',
    'long count=IntStream.of(0,1).map(n -> 10/n).count(); System.out.println(count);',
    '2\n',
  ),
  example(
    'stream-count-filter',
    'long count=IntStream.range(0,7).filter(n -> n%2==0).count(); System.out.println(count);',
    '4\n',
  ),
  example(
    'stream-large-range-limit',
    'System.out.println(IntStream.range(0,1000000000).limit(3).sum());',
    '3\n',
  ),
  example(
    'stream-large-range-count',
    'System.out.println(IntStream.rangeClosed(-2147483647,2147483647).count());',
    '4294967295\n',
  ),
  example(
    'stream-limit-zero',
    'System.out.println(IntStream.of(0).map(n -> 1/n).limit(0).sum());',
    '0\n',
  ),
  example(
    'stream-reduce',
    'System.out.println(IntStream.of(1,2,3,4).reduce(0,(a,b) -> a+b)); System.out.println(Stream.of("a","b","c").reduce("",(a,b) -> a+b));',
    '10\nabc\n',
  ),
  example(
    'stream-empty-reduce',
    'System.out.println(IntStream.empty().reduce(7,(a,b) -> a+b));',
    '7\n',
  ),
  example(
    'stream-for-each',
    'IntStream.of(1,2,3).map(n -> n*2).forEach(n -> System.out.print(n+" ")); System.out.println("done");',
    '2 4 6 done\n',
  ),
  example(
    'stream-for-each-ordered',
    'Stream.of("first","second").forEachOrdered(s -> { System.out.println(s); });',
    'first\nsecond\n',
  ),
  example(
    'stream-lazy-unused',
    'IntStream pending=IntStream.of(0).map(n -> 1/n); System.out.println("not evaluated");',
    'not evaluated\n',
  ),
  example(
    'stream-late-source',
    'List<Integer> values=new ArrayList<Integer>(); values.add(1); Stream<Integer> s=values.stream(); values.add(2); System.out.println(s.toList());',
    '[1, 2]\n',
  ),
  example(
    'stream-array-source',
    'int[] values={1,2,3}; IntStream s=Arrays.stream(values); values[0]=7; System.out.println(s.sum());',
    '12\n',
  ),
  example(
    'stream-int-array-of',
    'int[] values={1,2,3}; System.out.println(IntStream.of(values).sum());',
    '6\n',
  ),
  example(
    'stream-object-array-of',
    'String[] values={"a","b"}; System.out.println(Stream.of(values).toList());',
    '[a, b]\n',
  ),
  example(
    'stream-int-to-array',
    'int[] values=IntStream.range(1,4).map(n -> n*n).toArray(); System.out.println(Arrays.toString(values));',
    '[1, 4, 9]\n',
  ),
  example(
    'stream-object-to-array',
    'Object[] values=Stream.of("a","b").toArray(); System.out.println(Arrays.toString(values));',
    '[a, b]\n',
  ),
  example(
    'stream-collect-list',
    'List<String> values=Stream.of("a","bb","ccc").filter(s -> s.length()>1).collect(Collectors.toList()); System.out.println(values);',
    '[bb, ccc]\n',
  ),
  example(
    'stream-joining',
    'System.out.println(Stream.of("a","b","c").collect(Collectors.joining("-")));',
    'a-b-c\n',
  ),
  example(
    'stream-reuse',
    'IntStream s=IntStream.of(1,2); System.out.println(s.sum()); try { s.count(); } catch(IllegalStateException e) { System.out.println("used"); }',
    '3\nused\n',
  ),
  example(
    'stream-linked-reuse',
    'IntStream s=IntStream.of(1,2); IntStream next=s.map(n -> n+1); try { s.sum(); } catch(IllegalStateException e) { System.out.println("linked"); } System.out.println(next.sum());',
    'linked\n5\n',
  ),
  example(
    'stream-negative-limit',
    'try { IntStream.of(1).limit(-1); } catch(IllegalArgumentException e) { System.out.println("negative"); }',
    'negative\n',
  ),
  example(
    'stream-readonly-list',
    'List<Integer> values=Stream.of(1,2).toList(); try { values.add(3); } catch(UnsupportedOperationException e) { System.out.println("read-only"); }',
    'read-only\n',
  ),
  example(
    'stream-map-failure',
    'try { IntStream.of(2,0,4).map(n -> 8/n).forEach(n -> System.out.println(n)); } catch(ArithmeticException e) { System.out.println("stopped"); } finally { System.out.println("finished"); }',
    '4\nstopped\nfinished\n',
  ),
  example(
    'stream-null-item',
    'String missing=null; System.out.println(Stream.of("a",missing,"b").filter(s -> s!=null).toList());',
    '[a, b]\n',
  ),
  example(
    'stream-null-callback',
    'IntPredicate missing=null; try { IntStream.empty().filter(missing); } catch(NullPointerException e) { System.out.println("missing function"); }',
    'missing function\n',
  ),
  example(
    'lambda-capture',
    'int bonus=3; IntUnaryOperator add=n -> n+bonus; System.out.println(add.applyAsInt(4)); System.out.println(add.applyAsInt(8));',
    '7\n11\n',
  ),
  example(
    'lambda-typed-params',
    'IntBinaryOperator multiply=(int a,int b) -> a*b; System.out.println(multiply.applyAsInt(3,4));',
    '12\n',
  ),
  example(
    'lambda-block',
    'Function<String,Integer> size=s -> { int n=s.length(); if(n>2) return n; return 0; }; System.out.println(size.apply("hello")); System.out.println(size.apply("a"));',
    '5\n0\n',
  ),
  example(
    'lambda-predicate-variable',
    'Predicate<String> longName=s -> s.length()>2; System.out.println(Stream.of("Al","Maya").filter(longName).toList());',
    '[Maya]\n',
  ),
  example(
    'lambda-consumer',
    'Consumer<String> show=s -> System.out.println("Hi "+s); show.accept("Ana"); show.accept("Bo");',
    'Hi Ana\nHi Bo\n',
  ),
  example(
    'lambda-supplier',
    'int value=6; IntSupplier supply=() -> value*2; System.out.println(supply.getAsInt());',
    '12\n',
  ),
  example(
    'lambda-local-update',
    'IntUnaryOperator next=n -> { n+=1; return n; }; System.out.println(next.applyAsInt(4)); System.out.println(next.applyAsInt(4));',
    '5\n5\n',
  ),
  example(
    'stream-block-map-inference',
    'System.out.println(Stream.of("a","abcd").map(s -> { int n=s.length(); return n+1; }).toList());',
    '[2, 5]\n',
  ),
  example(
    'stream-overflow',
    'System.out.println(IntStream.of(2147483647,1).sum());',
    '-2147483648\n',
  ),
];
