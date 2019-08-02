import { useEffect, useRef, useState } from 'react';

type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
type ArgumentType<F extends Function> = F extends (arg: infer A) => any ? A : never;
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any;

export function createBifrostHooks<FunctionsType>(fns: FunctionsType): FnHookSDKType<FunctionsType> {
  const localFnSDK = {} as FnHookSDKType<FunctionsType>;

  Object.keys(fns).forEach((fnName) => {
    //@ts-ignore
    localFnSDK[fnName] = FnMethodsHelper2<never, never>({ fn: fns[fnName] });
  });

  return localFnSDK;
}

interface R1<ParamType, ResponseType> {
  useLocal: (p: ParamType, memoizationArr?: any[]) => { isLoading: boolean; error: Error; data: ResponseType };
}

function FnMethodsHelper2<ParamType, ResponseType>(p1: { fn: any }): R1<ParamType, ResponseType> {
  return {
    useLocal: (p: ParamType, memoizationArr?: any[]): { isLoading: boolean; error: Error; data: ResponseType } => {
      const [triggerRender, setTriggerRender] = useState(0);
      const ref = useRef<any>({
        data: null,
        isLoading: true,
        error: null
      });

      useEffect(() => {
        (async () => {
          try {
            let r = await p1.fn(p);
            ref.current = {
              data: r,
              isLoading: false,
              error: null
            };
          } catch (e) {
            ref.current = {
              data: undefined,
              isLoading: false,
              error: e
            };
          } finally {
            setTriggerRender(triggerRender + 1);
          }
        })();
      }, memoizationArr);

      return ref.current;
    }
  };
}

type FnHookSDKType<FunctionsType extends any> = {
  [K in keyof FunctionsType]: R1<ArgumentType<FunctionsType[K]>, UnpackPromise<ReturnType<FunctionsType[K]>>>;
};

// import * as express from 'express';
//
// type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
// type ArgumentType<F extends Function> = F extends (arg: infer A) => any ? A : never;
// type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any;
// // type FunctionsType = typeof functions;
//
// // TEMP
// async function hello1(p: { name: string }): Promise<string> {
//   console.log('Run Hello1');
//   return `Hello 1 ${p.name}`;
// }
// async function hello2(p: { name: string; age: number }): Promise<string> {
//   console.log('Run Hello2');
//   return `Hello 2 ${p.name}. You are ${p.age} years old`;
// }
// export const functions = {
//   hello1,
//   hello2
// };
//
// export function createBifrostHooks<FunctionsType>(fns: FunctionsType): FnHookSDKType<FunctionsType> {
//   const localFnSDK = {} as FnHookSDKType<FunctionsType>;
//
//   Object.keys(fns).forEach((fnName) => {
//     //@ts-ignore
//     localFnSDK[fnName] = new FnMethodsHelper<never, never>({ fn: fns[fnName] });
//   });
//
//   return localFnSDK;
// }
//
// console.log('Create bi-frost');
// class FnMethodsHelper<ParamType, ResponseType> {
//   private fn: any;
//   private fnName: string;
//
//   // constructor(p: { fn: any; fnName: string, httpPostFn: (p: { fnName: string; fnPayload: any }) => any }) {
//   constructor(p: { fn: any }) {
//     this.fn = p.fn;
//   }
//
//   // useRemote(p: ParamType, memoizationArr?: any[]): { isLoading: boolean; error: Error; data: ResponseType } {
//   //   const ref = useRef({
//   //     data: null,
//   //     isLoading: true,
//   //     error: null
//   //   });
//   //
//   //   useEffect(() => {
//   //     (async () => {
//   //       let r = await this.fn(...(p as any));
//   //       ref.current = {
//   //         data: r,
//   //         isLoading: false,
//   //         error: null
//   //       };
//   //       //Todo: Handle aborts, errors, etc..
//   //     })();
//   //   }, memoizationArr);
//   //
//   //   return ref.current;
//   // }
//
//   useLocal(p: ParamType, memoizationArr?: any[]): { isLoading: boolean; error: Error; data: ResponseType } {
//     const ref = useRef({
//       data: null,
//       isLoading: true,
//       error: null
//     });
//
//     useEffect(() => {
//       (async () => {
//         let r = await this.fn(...(p as any));
//         ref.current = {
//           data: r,
//           isLoading: false,
//           error: null
//         };
//         //Todo: Handle aborts, errors, etc..
//       })();
//     }, memoizationArr);
//
//     return ref.current;
//   }
// }
//
// type FnHookSDKType<FunctionsType extends any> = {
//   [K in keyof FunctionsType]: FnMethodsHelper<
//     ArgumentType<FunctionsType[K]>,
//     UnpackPromise<ReturnType<FunctionsType[K]>>
//   >;
// };
//
// // export const localFnSDK = {} as FnHookSDKType<any>;
// //
// // Object.keys(ServerEndpoints).forEach(fnName => {
// //     //@ts-ignore
// //     localFnSDK[fnName] = new FnMethodsHelper<never, never>(fnName);
// // });
