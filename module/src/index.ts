import Emittery from 'emittery';
import * as express from 'express';
import md5 from 'md5';
import { isSerializable } from './misc';

type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
type ArgumentType<F extends Function> = F extends (arg: infer A) => any ? A : never;
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any;

interface UseCacheFns {
  getCachedFnResult: (p: { key: string }) => Promise<string | undefined>;
  setCachedFnResult: (p: { key: string; value: any }) => Promise<void>;
}

type SubProps<T> = {
  dispose: () => void;
  onData: (fn: (a: T) => void) => void;
  onError: (fn: (a: Error) => void) => void;
  nextData: (a: T) => void;
  nextError: (e: Error) => void;
};
export class BifrostSub<T> {
  public dispose: () => void;
  public onData: (fn: (a: T) => void) => void;
  public onError: (fn: (a: Error) => void) => void;
  public nextData: (a: T) => void;
  public nextError: (e: Error) => void;

  constructor(p: SubProps<T>) {
    this.dispose = p.dispose;
    this.onData = p.onData;
    this.onError = p.onError;
    this.nextData = p.nextData;
    this.nextError = p.nextError;
  }
}

export function createBifrostSub<T>(a: { dispose: () => void }): BifrostSub<T> {
  const ee = new Emittery();

  return new BifrostSub({
    dispose: () => {
      ee.clearListeners();
      a.dispose();
    },
    onData: (fn: (a: T) => void) => {
      ee.on('data', fn);
    },
    onError: (fn: (e: Error) => void) => {
      ee.on('error', fn);
    },
    nextData: (a: T) => {
      ee.emit('data', a);
    },
    nextError: (e: Error) => {
      ee.emit('error', e);
    }
  });
}

export type UnpackBifrostSub<T> = T extends BifrostSub<infer U> ? U : T;

export function createBifrost<FunctionsType extends Record<string, Function>>(p: {
  fns: FunctionsType;
  reactModule: any; // NOTE: We use a peer dependency for react but since this code is meant to be executable on the server or client its a little strange to include react as part of your server build as well. Hence we just inject the module.
  useCacheFns?: UseCacheFns;
  httpProcessor?: HttpProcessor;
  logger?: Logger;
}): BifrostInstance<FunctionsType> {
  const localFnSDK = {} as BifrostInstance<FunctionsType>;

  Object.keys(p.fns).forEach((fnName) => {
    localFnSDK[fnName as keyof FunctionsType] = FnMethodsHelper<never, never>({
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

interface BifrostInstanceFn<ParamType, ResponseType> {
  useLocal: (p: ParamType, memoizationArr?: any[]) => { isLoading: boolean; error: Error; data: ResponseType };
  useLocalSub: (
    p: ParamType,
    memoizationArr: any[]
  ) => { isLoading: boolean; error: Error; data: UnpackBifrostSub<ResponseType> };
  useRemote: (p: ParamType, memoizationArr?: any[]) => { isLoading: boolean; error: Error; data: ResponseType };
  fetchLocal: (p: ParamType) => Promise<ResponseType>;
  fetchRemote: (p: ParamType) => Promise<ResponseType>;
}

type HttpProcessor = (p: { fnName: string; payload: any }) => Promise<any>;
type Logger = (p: { fnName: string; payload: any; error?: Error }) => any;

function FnMethodsHelper<ParamType, ResponseType>(p1: {
  fn: any;
  fnName: string;
  reactModule: any;
  useCacheFns: UseCacheFns | undefined;
  httpProcessor: HttpProcessor | undefined;
  logger: Logger | undefined;
}): BifrostInstanceFn<ParamType, ResponseType> {
  return {
    useLocal: (p: ParamType, memoizationArr: any[] = []) => {
      const [_, setTriggerRender] = p1.reactModule.useState(true);
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
            setTriggerRender((a) => !a);
          }
        })();
      }, memoizationArr);

      return ref.current;
    },
    useLocalSub: (p: ParamType, memoizationArr: any[] = []) => {
      const [_, setTriggerRender] = p1.reactModule.useState(true);
      const ref = p1.reactModule.useRef({
        data: null,
        isLoading: true,
        error: null
      });

      p1.reactModule.useEffect(() => {
        console.log(`Run useLocalSub for ${p1.fnName}`);
        let unsub: any;
        (async () => {
          try {
            let sub = await p1.fn(p);

            if (!(sub instanceof BifrostSub)) {
              throw new Error('useLocalSub may only be called on functions that return a BifrostSub');
            }

            if (p1.logger) {
              p1.logger({ fnName: p1.fnName, payload: { parameters: p, description: 'Initializing useLocalSub' } });
            }

            let cacheKey = `localSub-${p1.fnName}-${md5(JSON.stringify(p))}`;
            if (p1.useCacheFns) {
              let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
              if (cacheData) {
                console.log(`Found in cache: ${cacheKey}`);
                ref.current = { data: cacheData, isLoading: false, error: null };
                if (p1.logger) {
                  p1.logger({ fnName: p1.fnName, payload: { parameters: p, description: 'Got cached data' } });
                }
              } else {
                console.log(`Not found in cache: ${cacheKey}`);
              }
            }

            sub.onData((val) => {
              if (p1.logger) {
                p1.logger({ fnName: p1.fnName, payload: { parameters: p, description: 'Got new data from server' } });
              }
              ref.current = {
                data: val,
                isLoading: false,
                error: null
              };
              setTriggerRender((s) => !s);
            });

            sub.onError((err) => {
              if (p1.logger) {
                p1.logger({
                  fnName: p1.fnName,
                  payload: { parameters: p, error: err, description: 'Error in subscription stream' }
                });
              }
            });

            unsub = sub.dispose;
          } catch (e) {
            ref.current = {
              data: undefined,
              isLoading: false,
              error: e
            };
          }
        })();

        return unsub;
      }, memoizationArr);

      return ref.current;
    },
    fetchLocal: async (p: ParamType) => {
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
    fetchRemote: async (p: ParamType) => {
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
    useRemote: (p: ParamType, memoizationArr: any[] = []) => {
      const [_, setTriggerRender] = p1.reactModule.useState(true);
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
            setTriggerRender((a) => !a);
          }
        })();
      }, memoizationArr);

      return ref.current;
    }
  };
}

type BifrostInstance<FunctionsType extends Record<string, Function>> = {
  [K in keyof FunctionsType]: BifrostInstanceFn<
    ArgumentType<FunctionsType[K]>,
    UnpackPromise<ReturnType<FunctionsType[K]>>
  >;
};