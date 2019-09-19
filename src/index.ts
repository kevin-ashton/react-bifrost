import Emittery from 'emittery';
import * as express from 'express';
import md5 from 'md5';
import _ from 'lodash';
import jsonStableStringify from 'json-stable-stringify';

import { isSerializable } from './misc';

type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
type ArgumentType<F extends Function> = F extends (arg: infer A) => any ? A : never;
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any;

interface UseCacheFns {
  getCachedFnResult: (p: { key: string }) => Promise<{ cachedDateMS: number; value: any } | void>;
  setCachedFnResult: (p: { key: string; value: any }) => Promise<void>;
}

type SubProps<T> = {
  dispose: () => void;
  onData: (fn: (a: T) => void) => void;
  onError: (fn: (a: Error) => void) => void;
  nextData: (a: T, opts?: { ensureSequentialTimestamp?: number }) => void;
  nextError: (e: Error) => void;
};
export class BifrostSubscription<T> {
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

export function createBifrostSubscription<T>(a: { dispose: () => void }): BifrostSubscription<T> {
  const ee = new Emittery();

  let lastTimestamp = 0;
  let currentValue: any;

  return new BifrostSubscription({
    nextData: (data: T, opts: { ensureSequentialTimestamp?: number } = {}) => {
      const hasChanged = !_.isEqual(currentValue, data);
      const sequenceIsGood = opts.ensureSequentialTimestamp ? opts.ensureSequentialTimestamp > lastTimestamp : true;
      if (sequenceIsGood && hasChanged) {
        currentValue = data;
        lastTimestamp = opts.ensureSequentialTimestamp;
        ee.emit('data', data);
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
      // If data as previously been emitted provide it to the function
      if (currentValue) {
        fn(currentValue);
      }
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

export type UnpackBifrostSubscription<T> = T extends BifrostSubscription<infer U> ? U : T;

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

    if (hasAuthFn) {
      console.info(`Registering api path: ${apiPath}`);
    }

    p.expressApp.post(apiPath, async (req: express.Request, res: express.Response) => {
      try {
        if (p.logger) {
          p.logger({ fnName: fnName, details: { body: req.body } });
        }

        if (!hasAuthFn) {
          return res
            .status(401)
            .json({ status: 'unauthorized', details: 'No auth defined for this function. AuthKey: ' + p.fnAuthKey });
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
  useClient: (
    p: ParamType,
    memoizationArr: any[],
    options?: HelperOptions
  ) => { isLoading: boolean; error: Error; data: ResponseType; isFromCache: boolean };
  fetchClient: (p: ParamType, options?: HelperOptions) => Promise<{ data: ResponseType; isFromCache: boolean }>;
  useClientSubscription: (
    p: ParamType,
    memoizationArr: any[],
    options?: HelperOptions
  ) => { isLoading: boolean; error: Error; data: UnpackBifrostSubscription<ResponseType>; isFromCache: boolean };
  useServer: (
    p: ParamType,
    memoizationArr: any[],
    options?: HelperOptions
  ) => { isLoading: boolean; error: Error; data: ResponseType; isFromCache: boolean };
  fetchServer: (p: ParamType, options?: HelperOptions) => Promise<{ data: ResponseType; isFromCache: boolean }>;
}

type HttpProcessor = (p: { fnName: string; payload: any }) => Promise<any>;
type Logger = (p: { fnName: string; details: any; error?: Error }) => any;

interface HelperOptions {
  useCacheOnlyWithinMS?: number;
}

function FnMethodsHelper<ParamType, ResponseType>(p1: {
  fn: any;
  fnName: string;
  reactModule: any;
  useCacheFns: UseCacheFns | undefined;
  httpProcessor: HttpProcessor | undefined;
  logger: Logger | undefined;
}): BifrostInstanceFn<ParamType, ResponseType> {
  return {
    fetchClient: async (p: ParamType, options?: HelperOptions) => {
      if (p1.logger) {
        p1.logger({ fnName: p1.fnName, details: { type: 'fetchClient', payload: p } });
      }

      let cacheKey = `fetchClient-${p1.fnName}-${md5(jsonStableStringify(p))}`;
      if (p1.useCacheFns) {
        let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
        if (cacheData) {
          if (options && options.useCacheOnlyWithinMS) {
            let cutoff = Date.now() - options.useCacheOnlyWithinMS;
            if (cacheData.cachedDateMS > cutoff) {
              return {
                data: cacheData.value,
                isFromCache: true
              };
            }
          }
        }
      }

      try {
        let r = await p1.fn(p);
        if (p1.useCacheFns) {
          p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: r }).catch((e) => console.error(e));
        }
        return { data: r, isFromCache: false };
      } catch (e) {
        console.error(`Failed to fetchClient for ${p1.fnName}`);
        throw e;
      }
    },
    useClient: (p: ParamType, memoizationArr: any[] = [], options?: HelperOptions) => {
      const [_, setTriggerRender] = p1.reactModule.useState(true);
      const ref = p1.reactModule.useRef({
        data: null,
        isLoading: true,
        error: null,
        isFromCache: false
      });

      p1.reactModule.useEffect(() => {
        let hasUnmounted = false;
        async function setResult() {
          if (p1.logger) {
            p1.logger({ fnName: p1.fnName, details: { type: 'useClient', payload: p } });
          }

          let cacheKey = `useClient-${p1.fnName}-${md5(jsonStableStringify(p))}`;
          if (p1.useCacheFns) {
            let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
            if (cacheData) {
              ref.current = { data: cacheData.value, isLoading: false, error: null, isFromCache: true };
              if (!hasUnmounted) {
                setTriggerRender((s) => !s);
              }
              if (options && options.useCacheOnlyWithinMS) {
                let cutoff = Date.now() - options.useCacheOnlyWithinMS;
                if (cacheData.cachedDateMS > cutoff) {
                  // Since we are within the acceptable cache window
                  return;
                }
              }
            }
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
              isFromCache: false,
              error: null
            };
          } catch (e) {
            ref.current = {
              data: undefined,
              isLoading: false,
              isFromCache: false,
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
    useClientSubscription: (p: ParamType, memoizationArr: any[] = []) => {
      const [_, setTriggerRender] = p1.reactModule.useState(true);
      const ref = p1.reactModule.useRef({
        data: null,
        isLoading: true,
        isFromCache: false,
        error: null
      });

      p1.reactModule.useEffect(() => {
        let unsub: any = () => {};
        let hasUnmounted = false;

        async function setupSubscription() {
          try {
            if (p1.logger) {
              p1.logger({
                fnName: p1.fnName,
                details: {
                  type: 'useClientSubscription-setup',
                  parameters: p,
                  description: 'Initializing useClientSubscription'
                }
              });
            }

            let sub = p1.fn(p);
            if (sub.then) {
              let msg =
                'It appears the function that is supposed to be returning a BifrostSubscription is returning a promise. This is not allowed. Can cause various race conditions when components unmount ';
              console.error(msg);
              throw new Error(msg);
            }

            if (!(!!sub.dispose && !!sub.nextData && !!sub.nextError && !!sub.onData && !!sub.onError)) {
              let msg =
                'useClientSubscription may only be called on functions that return a BifrostSubscription or something with a similar shape';
              console.error(msg);
              throw new Error(msg);
            }

            let cacheKey = `useClientSubscription-${p1.fnName}-${md5(jsonStableStringify(p))}`;
            if (p1.useCacheFns) {
              let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
              if (cacheData) {
                ref.current = { data: cacheData.value, isLoading: false, error: null, isFromCache: true };
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
                  details: {
                    type: 'useClientSubscription-onData',
                    parameters: p,
                    description: 'Received data from sub'
                  }
                });
              }
              ref.current = {
                data: val,
                isLoading: false,
                isFromCache: false,
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
                  details: { type: 'useClientSubscription-error', parameters: p },
                  error: err
                });
              }
            });

            if (hasUnmounted) {
              sub.dispose();
            } else {
              unsub = () => sub.dispose();
            }
          } catch (e) {
            ref.current = {
              data: undefined,
              isLoading: false,
              isFromCache: false,
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
    fetchServer: async (p: ParamType, options?: HelperOptions) => {
      if (!p1.httpProcessor) {
        let msg = `HttpProcessor not defined. Cannot run useServer.`;
        console.error(msg);
        throw new Error(msg);
      }
      if (p1.logger) {
        p1.logger({ fnName: p1.fnName, details: { type: 'fetchServer', payload: p } });
      }

      let cacheKey = `fetchServer-${p1.fnName}-${md5(jsonStableStringify(p))}`;
      if (p1.useCacheFns) {
        let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
        if (cacheData) {
          if (options && options.useCacheOnlyWithinMS) {
            let cutoff = Date.now() - options.useCacheOnlyWithinMS;
            if (cacheData.cachedDateMS > cutoff) {
              return {
                data: cacheData.value,
                isFromCache: true
              };
            }
          }
        }
      }

      try {
        let r = await p1.httpProcessor({ fnName: p1.fnName, payload: p });
        if (p1.useCacheFns) {
          p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: r }).catch((e) => console.error(e));
        }

        return {
          data: r,
          isFromCache: false
        };
      } catch (e) {
        console.error(`Failed to fetchServer for ${p1.fnName}`);
        throw e;
      }
    },
    useServer: (p: ParamType, memoizationArr: any[] = [], options?: HelperOptions) => {
      const [_, setTriggerRender] = p1.reactModule.useState(true);
      const ref = p1.reactModule.useRef({
        data: null,
        isLoading: true,
        error: null,
        isFromCache: false
      });

      p1.reactModule.useEffect(() => {
        let hasUnmounted = false;

        async function fetchAndSetData() {
          if (!p1.httpProcessor) {
            let msg = `HttpProcessor not defined. Cannot run useServer.`;
            console.error(msg);
            throw new Error(msg);
          }

          if (p1.logger) {
            p1.logger({ fnName: p1.fnName, details: { type: 'useServer', payload: p } });
          }

          let cacheKey = `server-${p1.fnName}-${md5(jsonStableStringify(p))}`;
          if (p1.useCacheFns) {
            let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
            if (cacheData) {
              ref.current = { data: cacheData.value, isLoading: false, error: null, isFromCache: true };
              if (!hasUnmounted) {
                setTriggerRender((s) => !s);
              }
              if (options && options.useCacheOnlyWithinMS) {
                let cutoff = Date.now() - options.useCacheOnlyWithinMS;
                if (cacheData.cachedDateMS > cutoff) {
                  // Since we are within the acceptable cache window
                  console.log('------------------- JUST USING THE CACHE!');
                  return;
                }
              }
            }
          }

          try {
            let r1 = await p1.httpProcessor({ fnName: p1.fnName, payload: p });

            if (p1.useCacheFns) {
              p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: r1 }).catch((e) => console.error(e));
            }

            ref.current = {
              data: r1,
              isFromCache: false,
              isLoading: false,
              error: null
            };
          } catch (e) {
            ref.current = {
              data: undefined,
              isFromCache: false,
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
