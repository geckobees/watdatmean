import { describe, it, expect, vi } from 'vitest';
import { javaTraceLesson } from '../src/java-trace';
import { generate } from '../src/provider';
import { BridgeCore } from '../src/bridge/core';
import { wombRequest } from './quality/depth-cases';
import { javaGenericInterfaceCases } from './quality/java-generic-interface-cases';
describe('Java generics and interfaces', () => {
  it.each([
    [
      'unconstrained generic result in overloaded print',
      'static <T> T empty(){return null;}',
      'System.out.println(empty());',
    ],
    ['invariant arguments', 'static class Box<T>{}', 'Box<Object> b=new Box<String>();'],
    ['wrong bound', 'static class Box<T extends Number>{}', 'Box<String> b=new Box<>();'],
    [
      'invalid generic body',
      'static class Box<T>{int size(T x){return x.length();}}',
      'Box<String> b=new Box<>();',
    ],
    [
      'wrong generic store',
      'static class Box<T>{T value; void set(T x){value=x;}}',
      'Box<String> b=new Box<>(); b.set(3);',
    ],
    ['primitive argument', 'static class Box<T>{}', 'Box<int> b=new Box<>();'],
    ['raw type', 'static class Box<T>{}', 'Box b=new Box();'],
    ['wildcard capture', 'static class Box<T>{}', 'Box<?> b=new Box<String>();'],
    [
      'type variable allocation',
      'static class Box<T>{T make(){return new T();}}',
      'Box<String> b=new Box<>();',
    ],
    [
      'erasure clash',
      'static <T> int choose(T x){return 1;} static int choose(Object x){return 2;}',
      'System.out.println(choose("x"));',
    ],
    [
      'generic overload inference',
      'static <T> int choose(T x){return 1;} static int choose(String x){return 2;}',
      'System.out.println(choose("x"));',
    ],
    [
      'generic static type variable',
      'static class Box<T>{static T value(T x){return x;}}',
      'System.out.println(1);',
    ],
    [
      'missing implementation',
      'interface I{int get();} static class C implements I{}',
      'I i=new C();',
    ],
    [
      'missing public',
      'interface I{int get();} static class C implements I{int get(){return 1;}}',
      'I i=new C();',
    ],
    [
      'structural only',
      'interface I{int get();} static class C {public int get(){return 1;}}',
      'I i=new C();',
    ],
    ['interface allocation', 'interface I{int get();}', 'I i=new I();'],
    [
      'default conflict',
      'interface A{default int get(){return 1;}} interface B{default int get(){return 2;}} static class C implements A,B{}',
      'C c=new C();',
    ],
    [
      'default abstract conflict',
      'interface A{default int get(){return 1;}} interface B{int get();} static class C implements A,B{}',
      'C c=new C();',
    ],
    [
      'reabstract requires implementation',
      'interface A{default int get(){return 1;}} interface B extends A{int get();} static class C implements B{}',
      'C c=new C();',
    ],
    [
      'static is not implementation',
      'interface I{int get();} static class C implements I{public static int get(){return 1;}}',
      'C c=new C();',
    ],
    [
      'interface static not inherited',
      'interface A{static int get(){return 1;}} interface B extends A{}',
      'System.out.println(B.get());',
    ],
    [
      'interface static through instance',
      'interface A{static int get(){return 1;}} static class C implements A{}',
      'A a=new C(); System.out.println(a.get());',
    ],
    [
      'conflicting generic inheritance',
      'interface I<T>{} interface A extends I<String>{} interface B extends I<Integer>{} static class C implements A,B{}',
      'C c=new C();',
    ],
    ['invalid extends class', 'static class A{} interface B extends A{}', 'System.out.println(1);'],
    ['invalid implements class', 'static class A{} static class B implements A{}', 'B b=new B();'],
    [
      'cyclic interfaces',
      'interface A extends B{} interface B extends A{}',
      'System.out.println(1);',
    ],
    [
      'wrong SAM annotation',
      '@FunctionalInterface interface I{int a();int b();}',
      'System.out.println(1);',
    ],
    ['nonfunctional lambda', 'interface I{int a();int b();}', 'I i=()->1;'],
    [
      'bad override return',
      'interface I{String get();} static class C implements I{public Object get(){return "x";}}',
      'C c=new C();',
    ],
    [
      'unchecked cast',
      'static class Box<T>{}',
      'Object x=new Box<String>(); Box<Integer> b=(Box<Integer>)x;',
    ],
    ['generic array', 'static class Box<T>{T[] values;}', 'Box<String> b=new Box<>();'],
    [
      'inherited erasure clash',
      'static class A<T>{void set(T x){}} static class B extends A<String>{void set(Object x){}}',
      'B b=new B();',
    ],
    [
      'widened checked exception',
      'interface I{void run() throws Exception;} static class C implements I{public void run() throws Throwable{}}',
      'C c=new C();',
    ],
    [
      'interface constant outside subset',
      'interface I{int SIZE=2;}',
      'System.out.println(I.SIZE);',
    ],
    [
      'unresolved explicit default call',
      'interface I{default int get(){return 1;}} static class C implements I{public int get(){return I.super.get();}}',
      'System.out.println(new C().get());',
    ],
  ])('declines %s without inventing an output', (_, decl, body) => {
    expect(
      javaTraceLesson({
        ...wombRequest,
        code: `public class Demo {${decl} public static void main(String[] args){${body}}}`,
      }),
    ).toBeUndefined();
  });
  it.each(javaGenericInterfaceCases)(
    '$id matches full output locally on both adapters',
    async (c) => {
      const request = { ...wombRequest, code: c.code };
      const lesson = javaTraceLesson(request);
      expect(lesson, c.id).toBeDefined();
      expect(lesson!.output?.text).toBe(c.expected);
      const transport = vi.fn(() => {
        throw Error('No AI for supported generic/interface examples');
      });
      const direct = await generate(
        'groq',
        'qwen/qwen3.8-27b',
        'unused',
        request,
        undefined,
        transport,
      );
      const bridge = (await new BridgeCore(transport).dispatch(1, 'request', {
        provider: 'groq',
        model: 'qwen/qwen3.8-27b',
        key: 'unused',
        request,
      })) as any;
      expect(bridge.lesson).toEqual(direct);
      expect(direct.output?.text).toBe(c.expected);
      expect(direct.stepOutput?.join('')).toBe(c.expected);
      expect(direct.usage?.total).toBe(0);
      expect(direct.steps.length).toBeLessThanOrEqual(6);
      expect(transport).not.toHaveBeenCalled();
      const text = [direct.summary, ...direct.steps, direct.note].join(' ');
      expect(text).not.toMatch(/\$T\d+_/);
      expect(text.split(/\s+/).length).toBeLessThan(300);
      expect(direct.concepts.every((c) => !!c.explanation)).toBe(true);
    },
  );
  it('explains the selected overload and default implementation', () => {
    const lesson = (id: string) =>
      javaTraceLesson({
        ...wombRequest,
        code: javaGenericInterfaceCases.find((c) => c.id === id)!.code,
      })!;
    expect(lesson('generic-body-overload-bound').steps.join(' ')).toContain('Box.pick(Object)');
    expect(lesson('generic-body-overload-bound').concepts.map((c) => c.term)).not.toContain(
      'polymorphism',
    );
    expect(lesson('interface-default').steps.join(' ')).toContain('inherited default Named.label');
    expect(lesson('interface-static-with-args').steps.join(' ')).not.toContain('inherited default');
    expect(lesson('interface-class-wins').steps.join(' ')).toContain('Base.label');
    expect(
      lesson('generic-box-string').concepts.find((c) => c.term === 'Java generics')?.explanation,
    ).toContain('do not create separate runtime classes');
  });
});
