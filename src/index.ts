import * as express from 'express';
import { useEffect, useRef, useState } from 'react';

type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
type ArgumentType<F extends Function> = F extends (arg: infer A) => any ? A : never;
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any;

export function createBifrostHooks<FunctionsType>(
  fns: FunctionsType,
  httpProcessor?: HttpProcessor
): FnHookSDKType<FunctionsType> {
  const localFnSDK = {} as FnHookSDKType<FunctionsType>;

  Object.keys(fns).forEach((fnName) => {
    //@ts-ignore
    localFnSDK[fnName] = FnMethodsHelper<never, never>({
      fn: fns[fnName],
      fnName: fnName,
      httpProcessor: httpProcessor
    });
  });

  return localFnSDK;
}

export function registerFunctionsWithExpress(p: { fns: any; expressApp: express.Application; apiPrefix: string }) {
  Object.keys(p.fns).forEach((fnName) => {
    let apiPath = `${p.apiPrefix}/${fnName}`;
    console.log(`Api path registered: ${apiPath}`);
    p.expressApp.post(apiPath, async (req: express.Request, res: express.Response) => {
      try {
        let r1 = await p.fns[fnName](req.body);
        res.json(r1);
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error' });
      }
    });
  });
}

interface R1<ParamType, ResponseType> {
  useLocal: (p: ParamType, memoizationArr?: any[]) => { isLoading: boolean; error: Error; data: ResponseType };
  useRemote: (p: ParamType, memoizationArr?: any[]) => { isLoading: boolean; error: Error; data: ResponseType };
}

type HttpProcessor = (p: { fnName: string; payload: any }) => Promise<any>;

function FnMethodsHelper<ParamType, ResponseType>(p1: {
  fn: any;
  fnName: string;
  httpProcessor?: HttpProcessor;
}): R1<ParamType, ResponseType> {
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
    },
    useRemote: (p: ParamType, memoizationArr?: any[]): { isLoading: boolean; error: Error; data: ResponseType } => {
      const [triggerRender, setTriggerRender] = useState(0);
      const ref = useRef<any>({
        data: null,
        isLoading: true,
        error: null
      });

      useEffect(() => {
        (async () => {
          if (!p1.httpProcessor) {
            throw new Error(`HttpProcessor not defined. Cannot run useRemote. `);
          }
          try {
            let r1 = await p1.httpProcessor({ fnName: p1.fnName, payload: p });
            ref.current = {
              data: r1,
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
