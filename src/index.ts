import * as express from 'express';
import { isSerializable } from './misc';
import md5 from 'md5';

type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
type ArgumentType<F extends Function> = F extends (arg: infer A) => any ? A : never;
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any;

interface UseCacheFns {
  getCachedFnResult: (p: { key: string }) => Promise<string | undefined>;
  setCachedFnResult: (p: { key: string; value: any }) => Promise<void>;
}

export function createBifrost<FunctionsType>(p: {
  fns: FunctionsType;
  reactModule: any; // NOTE: We use a peer dependency for react but since this code is meant to be executable on the server or client its a little strange to include react as part of your server build as well. Hence we just inject the module.
  useCacheFns?: UseCacheFns;
  httpProcessor?: HttpProcessor;
  logger?: Logger;
}): FnSDKType<FunctionsType> {
  const localFnSDK = {} as FnSDKType<FunctionsType>;

  Object.keys(p.fns).forEach((fnName) => {
    localFnSDK[fnName] = FnMethodsHelper<never, never>({
      fn: p.fns[fnName],
      fnName: fnName,
      useCacheFns: p.useCacheFns,
      httpProcessor: p.httpProcessor,
      reactModule: p.reactModule,
      logger: p.logger
    });
  });

  return localFnSDK;
}

export function registerFunctionsWithExpress(p: {
  fns: any;
  expressApp: express.Application;
  fnAuthKey: string; // Endpoints are only registered if they have a auth function attached.  This a) Allows different auth for different envs (admin vs web-client), b) prevents us from exposing an endpoint accidently
  apiPrefix: string;
  logger?: Logger;
}) {
  let fnNames = Object.keys(p.fns);

  for (let i = 0; i < fnNames.length; i++) {
    let fnName = fnNames[i];
    let refinedApiPath = p.apiPrefix
      .split('/')
      .filter((n) => n.length > 0)
      .join('/');
    let apiPath = `/${refinedApiPath}/${fnName}`;

    let hasAuthFn = typeof p.fns[fnName][p.fnAuthKey] === 'function';

    if (!hasAuthFn) {
      console.warn(
        `Warning: No auth function specified for ${fnName}. Request to this function will be denied.  fnAuthKey: ${p.fnAuthKey}`
      );
    }

    console.log(`Registering api path: ${apiPath}`);
    p.expressApp.post(apiPath, async (req: express.Request, res: express.Response) => {
      try {
        if (p.logger) {
          p.logger({ fnName: fnName, payload: req.body });
        }

        if (!hasAuthFn) {
          return res.status(401).json({ status: 'unauthorized', details: 'no fnAuthKey defined' });
        }
        await p.fns[fnName][p.fnAuthKey](req);

        let r1 = await p.fns[fnName](req.body);
        if (!isSerializable(r1)) {
          return res
            .status(500)
            .json({ status: 'Error: Return data cannot be passed over the wire. Must be a plain javascript object.' });
        }
        res.json(r1);
      } catch (e) {
        if (e.statusCode && typeof e.statusCode === 'number' && e.error && e.error instanceof Error) {
          return res.status(e.statusCode).json({ status: 'Error' });
        } else {
          console.log(e);
          return res.status(500).json({ error: 'Error' });
        }
      }
    });
  }
}

interface R1<ParamType, ResponseType> {
  useLocal: (p: ParamType, memoizationArr?: any[]) => { isLoading: boolean; error: Error; data: ResponseType };
  useRemote: (p: ParamType, memoizationArr?: any[]) => { isLoading: boolean; error: Error; data: ResponseType };
  fetchLocal: (p: ParamType) => Promise<ResponseType>;
  fetchRemote: (p: ParamType) => Promise<ResponseType>;
}

type HttpProcessor = (p: { fnName: string; payload: any }) => Promise<any>;
type Logger = (p: { fnName: string; payload: any }) => any;

function FnMethodsHelper<ParamType, ResponseType>(p1: {
  fn: any;
  fnName: string;
  reactModule: any;
  useCacheFns: UseCacheFns | undefined;
  httpProcessor: HttpProcessor | undefined;
  logger: Logger | undefined;
}): R1<ParamType, ResponseType> {
  return {
    useLocal: (p: ParamType, memoizationArr: any[] = []): { isLoading: boolean; error: Error; data: ResponseType } => {
      const [triggerRender, setTriggerRender] = p1.reactModule.useState(0);
      const ref = p1.reactModule.useRef({
        data: null,
        isLoading: true,
        error: null
      });

      p1.reactModule.useEffect(() => {
        console.log(`Run useLocal for ${p1.fnName}`);
        (async () => {
          let cacheKey = `local-${p1.fnName}-${md5(JSON.stringify(p))}`;
          if (p1.useCacheFns) {
            let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
            if (cacheData) {
              console.log(`Found in cache: ${cacheKey}`);
              ref.current = { data: cacheData, isLoading: false, error: null };
            } else {
              console.log(`Not found in cache: ${cacheKey}`);
            }
          }

          if (p1.logger) {
            p1.logger({ fnName: p1.fnName, payload: p });
          }
          try {
            let r = await p1.fn(p);

            // Cache for the local useFunction
            if (p1.useCacheFns) {
              await p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: JSON.stringify(r) });
            }

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
    fetchLocal: async (p: ParamType): Promise<ResponseType> => {
      console.log(`Run fetchLocal for ${p1.fnName}`);
      if (p1.logger) {
        p1.logger({ fnName: p1.fnName, payload: p });
      }
      try {
        let r = await p1.fn(p);
        return r;
      } catch (e) {
        console.error(`Failed to fetchLocal for ${p1.fnName}`);
        throw e;
      }
    },

    fetchRemote: async (p: ParamType): Promise<ResponseType> => {
      console.log(`Run fetchRemote for ${p1.fnName}`);
      if (!p1.httpProcessor) {
        throw new Error(`HttpProcessor not defined. Cannot run useRemote. `);
      }
      if (p1.logger) {
        p1.logger({ fnName: p1.fnName, payload: p });
      }
      try {
        return await p1.httpProcessor({ fnName: p1.fnName, payload: p });
      } catch (e) {
        console.error(`Failed to fetchRemote for ${p1.fnName}`);
        throw e;
      }
    },
    useRemote: (p: ParamType, memoizationArr: any[] = []): { isLoading: boolean; error: Error; data: ResponseType } => {
      const [triggerRender, setTriggerRender] = p1.reactModule.useState(0);
      const ref = p1.reactModule.useRef({
        data: null,
        isLoading: true,
        error: null
      });

      p1.reactModule.useEffect(() => {
        console.log(`Run useRemote for ${p1.fnName}`);
        (async () => {
          if (!p1.httpProcessor) {
            throw new Error(`HttpProcessor not defined. Cannot run useRemote. `);
          }
          let cacheKey = `remote-${p1.fnName}-${md5(JSON.stringify(p))}`;
          if (p1.useCacheFns) {
            let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
            if (cacheData) {
              console.log(`Found in cache: ${cacheKey}`);
              ref.current = { data: JSON.parse(cacheData), isLoading: false, error: null };
            } else {
              console.log(`Not found in cache: ${cacheKey}`);
            }
          }

          if (p1.logger) {
            p1.logger({ fnName: p1.fnName, payload: p });
          }
          try {
            let r1 = await p1.httpProcessor({ fnName: p1.fnName, payload: p });

            // Cache for the local useFunction
            if (p1.useCacheFns) {
              await p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: JSON.stringify(r1) });
            }

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

type FnSDKType<FunctionsType extends any> = {
  [K in keyof FunctionsType]: R1<ArgumentType<FunctionsType[K]>, UnpackPromise<ReturnType<FunctionsType[K]>>>;
};
