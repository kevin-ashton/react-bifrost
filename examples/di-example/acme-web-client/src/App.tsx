import React, { useEffect, useRef, useState } from 'react';
import { createBifrostHooks } from 'react-bifrost';
import { functions } from 'acme-functions'
import './App.css';

// type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
// type ArgumentType<F extends Function> = F extends (arg: infer A) => any ? A : never;
// type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any;
// // type FunctionsType = typeof functions;
//
// // TEMP
// async function hello1(p: { name: string }): Promise<string> {
//   console.log('Run Hello1');
//   return `Hello 1 ${p.name}!!`;
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
//     // localFnSDK[fnName] = new FnMethodsHelper<never, never>({ fn: fns[fnName] });
//     localFnSDK[fnName] = FnMethodsHelper2<never, never>({ fn: fns[fnName] });
//   });
//
//   console.log('&&&&&&&&&&&&&&&&&&&&&&&&');
//   console.log(localFnSDK);
//   return localFnSDK;
// }
//
// interface R1<ParamType, ResponseType> {
//   useLocal: (p: ParamType, memoizationArr?: any[]) => { isLoading: boolean; error: Error; data: ResponseType };
// }
//
// function FnMethodsHelper2<ParamType, ResponseType>(p1: { fn: any }): R1<ParamType, ResponseType> {
//   return {
//     useLocal: (p: ParamType, memoizationArr?: any[]): { isLoading: boolean; error: Error; data: ResponseType } => {
//       const [triggerRender, setTriggerRender] = useState(0);
//       const ref = useRef<any>({
//         data: null,
//         isLoading: true,
//         error: null
//       });
//
//       useEffect(() => {
//         (async () => {
//           console.log('@@@@@@@@@@@@@@@@@@@@');
//           let r = await p1.fn(p);
//           ref.current = {
//             data: r,
//             isLoading: false,
//             error: null
//           };
//           setTriggerRender(triggerRender + 1);
//           //Todo: Handle aborts, errors, etc..
//         })();
//       }, memoizationArr);
//
//       return ref.current;
//     }
//   };
// }
//
// type FnHookSDKType<FunctionsType extends any> = {
//   [K in keyof FunctionsType]: R1<ArgumentType<FunctionsType[K]>, UnpackPromise<ReturnType<FunctionsType[K]>>>;
// };

let hooks = createBifrostHooks<typeof functions>(functions);

const App: React.FC = () => {
  return (
    <div className="App">
      <header className="App-header">
        <Comp1 />
        <p>
          Edit <code>src/App.tsx</code> and save to reload.
        </p>
        <a className="App-link" href="https://reactjs.org" target="_blank" rel="noopener noreferrer">
          Learn React
        </a>
      </header>
    </div>
  );
};

function Comp1() {
  const { isLoading, data, error } = hooks.hello3.useLocal({name: 'Kevin', age: 34})

  const [coutner, setCounter] = useState(1);
  // useEffect(() => {
  //   setInterval(() => {
  //     // console.log("----------------------");
  //     setCounter(Math.random());
  //   }, 2000);
  // }, []);

  const [data2, setData] = useState('hi');

  return (
    <div>
      <h1>{data}</h1>
      <div>{isLoading ? 'true' : 'false'}</div>

      <div onClick={() => setCounter(coutner + 1)}>{coutner}</div>
    </div>
  );
}

export default App;
