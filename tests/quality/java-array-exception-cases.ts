const example = (id: string, body: string, expected: string, members = '') => ({
  id,
  main: 'Demo',
  expected,
  code: `import java.util.*; public class Demo { ${members} public static void main(String[] args) { ${body} } }`,
});
// Independent outputs, also checked against compiled Java 17 execution.
export const javaArrayExceptionCases = [
  {
    id: 'array-covariant-field-view',
    main: 'Demo',
    expected: '1\nchild\n',
    code: 'class Parent { int n=1; String show() { return "parent"; } } class Child extends Parent { int n=2; @Override String show() { return "child"; } } public class Demo { public static void main(String[] args) { Parent[] a=new Child[]{new Child()}; System.out.println(a[0].n); System.out.println(a[0].show()); } }',
  },
  example(
    'array-unbox-store-order',
    'int[] a={1}; Integer n=null; try { a[3]=n; } catch(NullPointerException e) { System.out.println("null"); } catch(IndexOutOfBoundsException e) { System.out.println("bounds"); }',
    'null\n',
  ),
  example(
    'array-wrapper-compound-order',
    'Integer[] a={null}; try { a[0]+=mark(); } catch(NullPointerException e) { System.out.println("null"); }',
    'null\n',
    'static int mark() { System.out.println("wrong"); return 2; }',
  ),
  example(
    'array-sum',
    'int[] nums={2,4,6}; int total=0; for(int n:nums) total+=n; System.out.println(total); System.out.println(nums.length);',
    '12\n3\n',
  ),
  example(
    'array-defaults',
    'int[] nums=new int[3]; boolean[] flags=new boolean[2]; String[] names=new String[2]; System.out.println(Arrays.toString(nums)); System.out.println(Arrays.toString(flags)); System.out.println(Arrays.toString(names));',
    '[0, 0, 0]\n[false, false]\n[null, null]\n',
  ),
  example(
    'array-index-updates',
    'int nums[]={2,4}; nums[0]+=3; System.out.println(nums[0]++); System.out.println(++nums[1]); System.out.println(Arrays.toString(nums));',
    '5\n5\n[6, 5]\n',
  ),
  example(
    'array-empty',
    'int[] nums={}; for(int n:nums) System.out.print(n); System.out.println(nums.length); System.out.println(Arrays.toString(nums));',
    '0\n[]\n',
  ),
  example(
    'array-alias-clone',
    'int[] a={1,2}; int[] b=a; int[] c=a.clone(); b[0]=7; c[1]=9; System.out.println(a==b); System.out.println(a==c); System.out.println(Arrays.toString(a)); System.out.println(Arrays.toString(c));',
    'true\nfalse\n[7, 2]\n[1, 9]\n',
  ),
  example(
    'array-copy-grow',
    'String[] names={"Ada","Bo"}; String[] copy=Arrays.copyOf(names,3); copy[0]="Cy"; System.out.println(Arrays.toString(names)); System.out.println(Arrays.toString(copy));',
    '[Ada, Bo]\n[Cy, Bo, null]\n',
  ),
  example(
    'array-copy-truncate',
    'int[] a={1,2,3}; System.out.println(Arrays.toString(Arrays.copyOf(a,1)));',
    '[1]\n',
  ),
  example(
    'array-parameter',
    'int[] a={2,3}; bump(a); System.out.println(Arrays.toString(a));',
    '[3, 3]\n',
    'static void bump(int[] values) { values[0]++; }',
  ),
  example(
    'array-return',
    'int[] values=make(); System.out.println(Arrays.toString(values));',
    '[3, 5]\n',
    'static int[] make() { return new int[]{3,5}; }',
  ),
  example(
    'array-fields',
    'Demo d=new Demo(); System.out.println(d.values.length); d.values[0]=9; System.out.println(Arrays.toString(d.values));',
    '2\n[9, 2]\n',
    'int[] values={1,2};',
  ),
  example(
    'array-foreach-changes',
    'int[] a={1,2}; for(int n:a) { System.out.print(n); a[1]=7; n=9; } System.out.println(Arrays.toString(a));',
    '17[1, 7]\n',
  ),
  example(
    'array-matrix',
    'int[][] grid=new int[2][3]; grid[1][2]=5; System.out.println(Arrays.deepToString(grid));',
    '[[0, 0, 0], [0, 0, 5]]\n',
  ),
  example(
    'array-ragged',
    'int[][] rows={{1,2},{3}}; int sum=0; for(int[] row:rows) for(int n:row) sum+=n; System.out.println(sum); System.out.println(Arrays.deepToString(rows));',
    '6\n[[1, 2], [3]]\n',
  ),
  example(
    'array-partial-dimensions',
    'int[][] rows=new int[2][]; rows[0]=new int[]{7}; System.out.println(Arrays.deepToString(rows));',
    '[[7], null]\n',
  ),
  example(
    'array-shallow-clone',
    'int[][] a={{1},{2}}; int[][] b=a.clone(); b[0][0]=8; b[1]=new int[]{9}; System.out.println(Arrays.deepToString(a)); System.out.println(Arrays.deepToString(b));',
    '[[8], [2]]\n[[8], [9]]\n',
  ),
  example(
    'array-overload',
    'int[] a={1}; String[] b={"x"}; System.out.println(pick(a)); System.out.println(pick(b));',
    'int-array\nObject\n',
    'static String pick(int[] a) { return "int-array"; } static String pick(Object a) { return "Object"; }',
  ),
  example(
    'array-store-covariance',
    'Object[] a=new String[]{"x"}; try { a[0]=3; } catch(ArrayStoreException e) { System.out.println("store failed"); } System.out.println(Arrays.toString(a));',
    'store failed\n[x]\n',
  ),
  example(
    'array-cast',
    'Object a=new int[]{3,4}; int[] nums=(int[])a; System.out.println(nums[1]);',
    '4\n',
  ),
  example(
    'array-negative',
    'try { int[] a=new int[-1]; } catch(NegativeArraySizeException e) { System.out.println("negative"); }',
    'negative\n',
  ),
  example(
    'array-bounds',
    'int[] a={1}; try { System.out.println(a[1]); System.out.println("skipped"); } catch(IndexOutOfBoundsException e) { System.out.println("bounds"); } finally { System.out.println("done"); }',
    'bounds\ndone\n',
  ),
  example(
    'array-null-length',
    'int[] a=null; try { System.out.println(a.length); } catch(NullPointerException e) { System.out.println("null"); }',
    'null\n',
  ),
  example(
    'array-store-rhs-order',
    'int[] a=null; try { a[0]=mark(); } catch(NullPointerException e) { System.out.println("null"); }',
    'rhs\nnull\n',
    'static int mark() { System.out.println("rhs"); return 4; }',
  ),
  example(
    'array-compound-rhs-order',
    'int[] a=null; try { a[0]+=mark(); } catch(NullPointerException e) { System.out.println("null"); }',
    'null\n',
    'static int mark() { System.out.println("rhs"); return 4; }',
  ),
  example(
    'array-index-before-null',
    'int[] a=null; int i=0; try { System.out.println(a[i++]); } catch(NullPointerException e) { System.out.println(i); }',
    '1\n',
  ),
  example(
    'array-negative-dim-order',
    'try { int[][] a=new int[-1][mark()]; } catch(NegativeArraySizeException e) { System.out.println("negative"); }',
    'dimension\nnegative\n',
    'static int mark() { System.out.println("dimension"); return 2; }',
  ),
  example(
    'try-divide',
    'int n=0; try { System.out.println(10/n); } catch(ArithmeticException e) { System.out.println("cannot divide"); } System.out.println("after");',
    'cannot divide\nafter\n',
  ),
  example(
    'try-normal',
    'try { System.out.println("ok"); } catch(RuntimeException e) { System.out.println("wrong"); } finally { System.out.println("cleanup"); }',
    'ok\ncleanup\n',
  ),
  example(
    'throw-message',
    'try { throw new IllegalArgumentException("bad input"); } catch(RuntimeException e) { System.out.println(e.getMessage()); System.out.println(e.toString()); }',
    'bad input\njava.lang.IllegalArgumentException: bad input\n',
  ),
  example(
    'checked-helper',
    'try { fail(); } catch(Exception e) { System.out.println(e.getMessage()); }',
    'checked\n',
    'static void fail() throws Exception { throw new Exception("checked"); }',
  ),
  example(
    'catch-order',
    'try { throw new ArrayIndexOutOfBoundsException("range"); } catch(ArrayIndexOutOfBoundsException e) { System.out.println("specific"); } catch(IndexOutOfBoundsException e) { System.out.println("general"); }',
    'specific\n',
  ),
  example(
    'multi-catch',
    'try { throw new IllegalStateException("state"); } catch(ArithmeticException | IllegalStateException e) { System.out.println(e.getMessage()); }',
    'state\n',
  ),
  example(
    'outer-catch',
    'try { try { throw new IllegalStateException("bad"); } catch(ArithmeticException e) { System.out.println("wrong"); } finally { System.out.println("inner finally"); } } catch(RuntimeException e) { System.out.println("outer catch"); }',
    'inner finally\nouter catch\n',
  ),
  example(
    'rethrow',
    'try { try { throw new IllegalStateException("bad"); } catch(RuntimeException e) { System.out.println("inner"); throw e; } } catch(IllegalStateException e) { System.out.println(e.getMessage()); }',
    'inner\nbad\n',
  ),
  example(
    'throw-null',
    'try { throw null; } catch(NullPointerException e) { System.out.println("null throw"); }',
    'null throw\n',
  ),
  example(
    'finally-saved-return',
    'System.out.println(value());',
    'finally2\n1\n',
    'static int value() { int n=1; try { return n; } finally { n=2; System.out.println("finally"+n); } }',
  ),
  example(
    'finally-return-replaces',
    'System.out.println(value());',
    '2\n',
    'static int value() { try { return 1; } finally { return 2; } }',
  ),
  example(
    'finally-suppresses-throw',
    'System.out.println(value());',
    '7\n',
    'static int value() { try { throw new IllegalStateException("bad"); } finally { return 7; } }',
  ),
  example(
    'finally-throw-replaces-return',
    'try { System.out.println(value()); } catch(IllegalStateException e) { System.out.println(e.getMessage()); }',
    'cleanup failed\n',
    'static int value() { try { return 1; } finally { throw new IllegalStateException("cleanup failed"); } }',
  ),
  example(
    'finally-throw-replaces-throw',
    'try { try { throw new ArithmeticException("first"); } finally { throw new IllegalStateException("second"); } } catch(RuntimeException e) { System.out.println(e.getMessage()); }',
    'second\n',
  ),
  example(
    'finally-loop-control',
    'for(int i=0;i<3;i++) { try { if(i==0) continue; if(i==1) break; } finally { System.out.print(i); } }',
    '01',
  ),
  example(
    'loop-exception-propagation',
    'try { for(int i=0;i<3;i++) { System.out.print(i); if(i==1) throw new IllegalStateException("stop"); } } catch(RuntimeException e) { System.out.println("caught"); }',
    '01caught\n',
  ),
  example(
    'catch-in-loop',
    'int[] a={4,5}; for(int i=0;i<3;i++) { try { System.out.print(a[i]); } catch(IndexOutOfBoundsException e) { System.out.print("x"); } }',
    '45x',
  ),
  example(
    'unbox-before-finally',
    'try { System.out.println(value()); } catch(NullPointerException e) { System.out.println("null"); }',
    'finally\nnull\n',
    'static int value() { Integer n=null; try { return n; } finally { System.out.println("finally"); } }',
  ),
  example(
    'unbox-before-right',
    'Integer n=null; try { System.out.println(n+mark()); } catch(NullPointerException e) { System.out.println("null"); }',
    'null\n',
    'static int mark() { System.out.println("wrong"); return 2; }',
  ),
  example(
    'unbox-argument-order',
    'Integer n=null; try { take(n,mark()); } catch(NullPointerException e) { System.out.println("null"); }',
    'null\n',
    'static int mark() { System.out.println("wrong"); return 2; } static void take(int a,int b) { System.out.println("wrong"); }',
  ),
  example(
    'field-simple-assignment-order',
    'Demo d=null; try { d.n=mark(); } catch(NullPointerException e) { System.out.println("null"); }',
    'rhs\nnull\n',
    'int n=0; static int mark() { System.out.println("rhs"); return 2; }',
  ),
  example(
    'collection-caught-bounds',
    'List<Integer> a=new ArrayList<>(List.of(1)); try { System.out.println(a.get(2)); } catch(IndexOutOfBoundsException e) { System.out.println("bounds"); }',
    'bounds\n',
  ),
  example(
    'immutable-caught-mutation',
    'List<Integer> a=List.of(1); try { a.add(2); } catch(UnsupportedOperationException e) { System.out.println("read only"); }',
    'read only\n',
  ),
  example(
    'constructor-caught-throw',
    'try { Demo d=new Demo(); } catch(IllegalStateException e) { System.out.println("failed"); }',
    'construct\nfailed\n',
    'Demo() { System.out.println("construct"); throw new IllegalStateException("bad"); }',
  ),
];
