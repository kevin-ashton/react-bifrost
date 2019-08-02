import * as express from 'express';

type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
type ArgumentType<F extends Function> = F extends (arg: infer A) => any ? A : never;
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any;

export function createBifrostHooks<FunctionsType>(
  fns: FunctionsType,
  reactModule: any, // NOTE: We use a peer dependency for react but since this code is meant to be executable on the server or client its a little strange to include react as part of your server build as well. Hence we just inject the module.
  httpProcessor?: HttpProcessor,
  logger?: Logger
): FnHookSDKType<FunctionsType> {
  const localFnSDK = {} as FnHookSDKType<FunctionsType>;

  Object.keys(fns).forEach((fnName) => {
    localFnSDK[fnName] = FnMethodsHelper<never, never>({
      fn: fns[fnName],
      fnName: fnName,
      httpProcessor: httpProcessor,
      reactModule: reactModule,
      logger: logger
    });
  });

  return localFnSDK;
}

export function registerFunctionsWithExpress(p: {
  fns: any;
  expressApp: express.Application;
  apiPrefix: string;
  logger?: Logger;
}) {
  Object.keys(p.fns).forEach((fnName) => {
    let refinedApiPath = p.apiPrefix
      .split('/')
      .filter((n) => n.length > 0)
      .join('/');
    let apiPath = `/${refinedApiPath}/${fnName}`;

    console.log(`Api path registered: ${apiPath}`);
    p.expressApp.post(apiPath, async (req: express.Request, res: express.Response) => {
      try {
        if (p.logger) {
          p.logger({ fnName: fnName, payload: req.body });
        }

        let r1 = await p.fns[fnName](req.body, req);
        res.json(r1);
      } catch (e) {
        if (e.statusCode && typeof e.statusCode === 'number' && e.error && e.error instanceof Error) {
          return res.status(e.statusCode).json({ status: 'Error' });
        } else {
          return res.status(500).json({ error: 'Error' });
        }
      }
    });
  });
}

interface R1<ParamType, ResponseType> {
  useLocal: (p: ParamType, memoizationArr?: any[]) => { isLoading: boolean; error: Error; data: ResponseType };
  useRemote: (p: ParamType, memoizationArr?: any[]) => { isLoading: boolean; error: Error; data: ResponseType };
}

type HttpProcessor = (p: { fnName: string; payload: any }) => Promise<any>;
type Logger = (p: { fnName: string; payload: any }) => any;

function FnMethodsHelper<ParamType, ResponseType>(p1: {
  fn: any;
  fnName: string;
  reactModule: any;
  httpProcessor?: HttpProcessor;
  logger?: Logger;
}): R1<ParamType, ResponseType> {
  return {
    useLocal: (p: ParamType, memoizationArr?: any[]): { isLoading: boolean; error: Error; data: ResponseType } => {
      const [triggerRender, setTriggerRender] = p1.reactModule.useState(0);
      const ref = p1.reactModule.useRef({
        data: null,
        isLoading: true,
        error: null
      });

      p1.reactModule.useEffect(() => {
        (async () => {
          console.log('useLocal executed');
          if (p1.logger) {
            p1.logger({ fnName: p1.fnName, payload: p });
          }
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
      const [triggerRender, setTriggerRender] = p1.reactModule.useState(0);
      const ref = p1.reactModule.useRef({
        data: null,
        isLoading: true,
        error: null
      });

      p1.reactModule.useEffect(() => {
        console.log('useRemote executed');
        (async () => {
          if (!p1.httpProcessor) {
            throw new Error(`HttpProcessor not defined. Cannot run useRemote. `);
          }
          if (p1.logger) {
            p1.logger({ fnName: p1.fnName, payload: p });
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
      }, [memoizationArr]);

      return ref.current;
    }
  };
}

type FnHookSDKType<FunctionsType extends any> = {
  [K in keyof FunctionsType]: R1<ArgumentType<FunctionsType[K]>, UnpackPromise<ReturnType<FunctionsType[K]>>>;
};
