import Emittery from 'emittery';
import * as express from 'express';
import md5 from 'md5';
import { isSerializable } from './misc';

type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
type ArgumentType<F extends Function> = F extends (arg: infer A) => any ? A : never;
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any;

interface UseCacheFns {
  getCachedFnResult: (p: { key: string }) => Promise<any | undefined>;
  setCachedFnResult: (p: { key: string; value: any }) => Promise<void>;
}

type SubProps<T> = {
  dispose: () => void;
  onData: (fn: (a: T) => void) => void;
  onError: (fn: (a: Error) => void) => void;
  nextData: (a: T, opts?: { ensureSequentialTimestamp?: number }) => void;
  nextError: (e: Error) => void;
};
export class BifrostSub<T> {
  public dispose: () => void;
  public onData: (fn: (a: T) => void) => void;
  public onError: (fn: (a: Error) => void) => void;
  public nextData: (a: T, opts?: { ensureSequentialTimestamp?: number }) => void;
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

  let lastTimestamp = 0;

  return new BifrostSub({
    nextData: (a: T, opts: { ensureSequentialTimestamp?: number } = {}) => {
      const shouldEmit = opts.ensureSequentialTimestamp ? opts.ensureSequentialTimestamp > lastTimestamp : true;
      if (shouldEmit) {
        lastTimestamp = opts.ensureSequentialTimestamp;
        ee.emit('data', a);
      }
    },
    dispose: () => {
      try {
        ee.clearListeners();
        a.dispose();
      } catch (e) {
        console.error('Unable to dispose', e);
      }
    },
    onData: (fn: (a: T) => void) => {
      ee.on('data', fn);
    },
    onError: (fn: (e: Error) => void) => {
      ee.on('error', fn);
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

    console.info(`Registering api path: ${apiPath}`);
    p.expressApp.post(apiPath, async (req: express.Request, res: express.Response) => {
      try {
        if (p.logger) {
          p.logger({ fnName: fnName, details: { body: req.body } });
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
          console.error(e);
          return res.status(500).json({ error: 'Error' });
        }
      }
    });
  }
}

interface BifrostInstanceFn<ParamType, ResponseType> {
  useLocal: (p: ParamType, memoizationArr: any[]) => { isLoading: boolean; error: Error; data: ResponseType };
  useLocalSub: (
    p: ParamType,
    memoizationArr: any[]
  ) => { isLoading: boolean; error: Error; data: UnpackBifrostSub<ResponseType> };
  useRemote: (p: ParamType, memoizationArr: any[]) => { isLoading: boolean; error: Error; data: ResponseType };
  fetchLocal: (p: ParamType) => Promise<ResponseType>;
  fetchRemote: (p: ParamType) => Promise<ResponseType>;
}

type HttpProcessor = (p: { fnName: string; payload: any }) => Promise<any>;
type Logger = (p: { fnName: string; details: any; error?: Error }) => any;

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
        let hasUnmounted = false;
        async function setResult() {
          let cacheKey = `local-${p1.fnName}-${md5(JSON.stringify(p))}`;
          if (p1.useCacheFns) {
            let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
            if (cacheData) {
              ref.current = { data: cacheData, isLoading: false, error: null };
              if (!hasUnmounted) {
                setTriggerRender((s) => !s);
              }
            }
          }

          if (p1.logger) {
            p1.logger({ fnName: p1.fnName, details: { type: 'useLocal', payload: p } });
          }

          try {
            let r = await p1.fn(p);

            // Cache for the local useFunction
            if (p1.useCacheFns) {
              p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: r }).catch((e) => console.error(e));
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
            if (!hasUnmounted) {
              setTriggerRender((a) => !a);
            }
          }
        }

        setResult();

        return () => {
          hasUnmounted = true;
        };
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
        let unsub: any;
        let hasUnmounted = false;

        async function setupSubscription() {
          try {
            let sub = await p1.fn(p);

            if (!(!!sub.dispose && !!sub.nextData && !!sub.nextError && !!sub.onData && !!sub.onError)) {
              throw new Error(
                'useLocalSub may only be called on functions that return a BifrostSub or something with a similar shape'
              );
            }

            if (p1.logger) {
              p1.logger({
                fnName: p1.fnName,
                details: { type: 'useLocalSub-setup', parameters: p, description: 'Initializing useLocalSub' }
              });
            }

            let cacheKey = `localSub-${p1.fnName}-${md5(JSON.stringify(p))}`;
            if (p1.useCacheFns) {
              let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
              if (cacheData) {
                ref.current = { data: cacheData, isLoading: false, error: null };
                if (!hasUnmounted) {
                  setTriggerRender((s) => !s);
                }
              }
            }

            sub.onData((val) => {
              if (p1.useCacheFns) {
                p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: val }).catch((e) => console.error(e));
              }
              if (p1.logger) {
                p1.logger({
                  fnName: p1.fnName,
                  details: { type: 'useLocalSub-onData', parameters: p, description: 'Received data from sub' }
                });
              }
              ref.current = {
                data: val,
                isLoading: false,
                error: null
              };

              if (!hasUnmounted) {
                setTriggerRender((s) => !s);
              }
            });

            sub.onError((err) => {
              if (p1.logger) {
                p1.logger({
                  fnName: p1.fnName,
                  details: { type: 'useLocalSub-error', parameters: p },
                  error: err
                });
              }
            });

            unsub = () => sub.dispose();
          } catch (e) {
            ref.current = {
              data: undefined,
              isLoading: false,
              error: e
            };
          }
        }

        setupSubscription();

        return () => {
          hasUnmounted = true;
          unsub();
        };
      }, memoizationArr);

      return ref.current;
    },
    fetchLocal: async (p: ParamType) => {
      if (p1.logger) {
        p1.logger({ fnName: p1.fnName, details: { type: 'fetchLocal', payload: p } });
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
      if (!p1.httpProcessor) {
        throw new Error(`HttpProcessor not defined. Cannot run useRemote. `);
      }
      if (p1.logger) {
        p1.logger({ fnName: p1.fnName, details: { type: 'fetchRemote', payload: p } });
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
        let hasUnmounted = false;

        async function fetchAndSetData() {
          if (!p1.httpProcessor) {
            throw new Error(`HttpProcessor not defined. Cannot run useRemote. `);
          }
          let cacheKey = `remote-${p1.fnName}-${md5(JSON.stringify(p))}`;
          if (p1.useCacheFns) {
            let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
            if (cacheData) {
              ref.current = { data: cacheData, isLoading: false, error: null };
              if (!hasUnmounted) {
                setTriggerRender((s) => !s);
              }
            }
          }

          if (p1.logger) {
            p1.logger({ fnName: p1.fnName, details: { type: 'useRemote', payload: p } });
          }
          try {
            let r1 = await p1.httpProcessor({ fnName: p1.fnName, payload: p });

            // Cache for the local useFunction
            if (p1.useCacheFns) {
              p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: r1 }).catch((e) => console.error(e));
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
            if (!hasUnmounted) {
              setTriggerRender((a) => !a);
            }
          }
        }

        fetchAndSetData();

        return () => {
          hasUnmounted = true;
        };
      }, memoizationArr);

      return ref.current;
    }
  };
}

export type BifrostInstance<FunctionsType extends Record<string, Function>> = {
  [K in keyof FunctionsType]: BifrostInstanceFn<
    ArgumentType<FunctionsType[K]>,
    UnpackPromise<ReturnType<FunctionsType[K]>>
  >;
};
