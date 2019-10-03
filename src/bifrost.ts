import {
  UseCacheFns,
  HttpProcessor,
  Logger,
  BifrostInstance,
  BifrostInstanceFn,
  HelperOptions,
  SubscriptionHelperOptions
} from './models';
import jsonStableStringify from 'json-stable-stringify';
import md5 from 'md5';

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

function FnMethodsHelper<ParamType, ResponseType>(p1: {
  fn: any;
  fnName: string;
  reactModule: any;
  useCacheFns: UseCacheFns | undefined;
  httpProcessor: HttpProcessor | undefined;
  logger: Logger | undefined;
}): BifrostInstanceFn<ParamType, ResponseType> {
  const cacheExists = !!p1.useCacheFns;
  const loggerExists = !!p1.logger;
  const cacheTimeframeExists = (options: HelperOptions) => {
    return options && options.useCacheOnlyWithinMS;
  };
  const cacheNotDisabled = (options: HelperOptions | SubscriptionHelperOptions) => {
    return !(options && options.disableCache);
  };
  const cacheDataValid = ({ options, cachedDateMS }: { options: HelperOptions; cachedDateMS: number }): boolean => {
    if (options) {
      let cutoff = Date.now() - options.useCacheOnlyWithinMS;
      return cachedDateMS > cutoff;
    } else {
      return false;
    }
  };

  const ensureIsBifrostSubscription = (p: { sub: any; callingFn: string }) => {
    if (!(!!p.sub.dispose && !!p.sub.nextData && !!p.sub.nextError && !!p.sub.onData && !!p.sub.onError)) {
      let msg = `${p.callingFn} may only be called on functions that return a BifrostSubscription or something with a similar shape`;
      console.error(msg);
      throw new Error(msg);
    }
  };

  const ensureNotPromise = (p: { sub: any; callingFn: string }) => {
    if (p.sub.then) {
      let msg = `Problem in ${p.callingFn}. It appears the function that is supposed to be returning a BifrostSubscription is returning a promise. This is not allowed. Can cause various race conditions when components unmount. Oc`;
      console.error(msg);
      throw new Error(msg);
    }
  };

  const cacheValueToReturnForFetch = (p: {
    cacheKey: string;
    options: HelperOptions;
  }): { data: any; isFromCache: true } | void => {
    if (cacheExists && cacheTimeframeExists(p.options) && cacheNotDisabled(p.options)) {
      let cacheData = p1.useCacheFns.getCachedFnResult({ key: p.cacheKey });
      if (cacheData) {
        if (cacheDataValid({ options: p.options, cachedDateMS: cacheData.cachedDateMS })) {
          return {
            data: cacheData.value,
            isFromCache: true
          };
        }
      }
    }
  };

  const getInitialRefValForUse = (p: {
    cacheKey: string;
    options?: HelperOptions | SubscriptionHelperOptions;
  }): { data: any; isLoading: boolean; error: any; isFromCache: any } => {
    if (cacheExists && cacheNotDisabled(p.options)) {
      const cacheData = p1.useCacheFns.getCachedFnResult({ key: p.cacheKey });
      if (cacheData) {
        return {
          data: cacheData.value,
          isLoading: false,
          error: null,
          isFromCache: true
        };
      }
    }
    return {
      data: null,
      isLoading: true,
      error: null,
      isFromCache: false
    };
  };

  return {
    getClientSubscription: (p: ParamType, options?: SubscriptionHelperOptions) => {
      return {
        subscribe: (fn) => {
          let sub = p1.fn(p);
          ensureNotPromise({ callingFn: 'getClientSubscription', sub });
          ensureIsBifrostSubscription({ callingFn: 'getClientSubscription', sub });

          let cacheKey = `getClientSubscription-${p1.fnName}-${md5(jsonStableStringify(p))}`;
          if (cacheExists && cacheNotDisabled(options)) {
            let c = p1.useCacheFns.getCachedFnResult({ key: cacheKey });
            if (c) {
              fn(c.value);
            }
          }

          sub.onData((val) => {
            if (cacheExists) {
              p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: val });
            }
            if (loggerExists) {
              p1.logger({
                fnName: p1.fnName,
                details: {
                  type: 'getClientSubscription-onData',
                  parameters: p,
                  description: 'Received data from sub'
                }
              });
            }
            fn({ data: val, isFromCache: false });
          });

          sub.onError((err) => {
            console.error(err);
            if (loggerExists) {
              p1.logger({
                fnName: p1.fnName,
                details: { type: 'getClientSubscription-error', parameters: p },
                error: err
              });
            }
          });

          return {
            unsubscribe: () => {
              sub.dispose();
            }
          };
        }
      };
    },
    fetchClient: async (p: ParamType, options?: HelperOptions) => {
      if (loggerExists) {
        p1.logger({ fnName: p1.fnName, details: { type: 'fetchClient', payload: p } });
      }

      // Check if we should use the cache and if anything is there first
      let cacheKey = `fetchClient-${p1.fnName}-${md5(jsonStableStringify(p))}`;
      let cacheValue = cacheValueToReturnForFetch({ options, cacheKey });
      if (cacheValue) {
        return cacheValue;
      }

      // Since we aren't using the cache just run the function
      try {
        let r = await p1.fn(p);
        if (cacheExists) {
          p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: r });
        }
        return { data: r, isFromCache: false };
      } catch (e) {
        console.error(`Failed to fetchClient for ${p1.fnName}`);
        throw e;
      }
    },
    useClient: (p: ParamType, memoizationArr: any[] = [], options?: SubscriptionHelperOptions) => {
      const [_, setTriggerRender] = p1.reactModule.useState(true);

      const cacheKey = p1.reactModule.useMemo(
        () => `useClient-${p1.fnName}-${md5(jsonStableStringify(p))}`,
        memoizationArr
      );
      const initialRefVal = p1.reactModule.useMemo(
        () => getInitialRefValForUse({ cacheKey: cacheKey, options }),
        memoizationArr
      );

      const ref = p1.reactModule.useRef(initialRefVal);

      p1.reactModule.useEffect(() => {
        let hasUnmounted = false;
        async function setResult() {
          if (loggerExists) {
            p1.logger({ fnName: p1.fnName, details: { type: 'useClient', payload: p } });
          }

          if (cacheExists && cacheNotDisabled(options)) {
            let cacheData = p1.useCacheFns.getCachedFnResult({ key: cacheKey });
            if (cacheData) {
              if (cacheDataValid({ options, cachedDateMS: cacheData.cachedDateMS })) {
                // Since we are within the acceptable cache window no need to run the actual function
                return;
              }
            }
          }

          try {
            let r = await p1.fn(p);

            // Cache for the local useFunction
            if (cacheExists) {
              p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: r });
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
    useClientSubscription: (p: ParamType, memoizationArr: any[] = [], options?: SubscriptionHelperOptions) => {
      const [_, setTriggerRender] = p1.reactModule.useState(true);

      const cacheKey = p1.reactModule.useMemo(
        () => `useClientSubscription-${p1.fnName}-${md5(jsonStableStringify(p))}`,
        memoizationArr
      );

      const initialRefVal = p1.reactModule.useMemo(
        () => getInitialRefValForUse({ cacheKey: cacheKey, options }),
        memoizationArr
      );

      const ref = p1.reactModule.useRef(initialRefVal);

      p1.reactModule.useEffect(() => {
        let unsub: any = () => {};
        let hasUnmounted = false;

        async function setupSubscription() {
          try {
            if (loggerExists) {
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
            ensureNotPromise({ callingFn: 'useClientSubscription', sub });
            ensureIsBifrostSubscription({ callingFn: 'useClientSubscription', sub });

            sub.onData((val) => {
              if (cacheExists) {
                p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: val });
              }
              if (loggerExists) {
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
              if (loggerExists) {
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
      if (loggerExists) {
        p1.logger({ fnName: p1.fnName, details: { type: 'fetchServer', payload: p } });
      }

      // Check if we should use the cache and if anything is there first
      let cacheKey = `fetchServer-${p1.fnName}-${md5(jsonStableStringify(p))}`;
      let cacheValue = cacheValueToReturnForFetch({ options, cacheKey });
      if (cacheValue) {
        return cacheValue;
      }

      // Since we aren't using the cache just run the function
      try {
        let r = await p1.httpProcessor({ fnName: p1.fnName, payload: p });
        if (cacheExists) {
          p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: r });
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

      const cacheKey = p1.reactModule.useMemo(
        () => `server-${p1.fnName}-${md5(jsonStableStringify(p))}`,
        memoizationArr
      );

      const initialRefVal = p1.reactModule.useMemo(
        () => getInitialRefValForUse({ cacheKey: cacheKey, options }),
        memoizationArr
      );

      const ref = p1.reactModule.useRef(initialRefVal);

      p1.reactModule.useEffect(() => {
        let hasUnmounted = false;

        async function fetchAndSetData() {
          if (!p1.httpProcessor) {
            let msg = `HttpProcessor not defined. Cannot run useServer.`;
            console.error(msg);
            throw new Error(msg);
          }

          if (loggerExists) {
            p1.logger({ fnName: p1.fnName, details: { type: 'useServer', payload: p } });
          }

          if (cacheExists && cacheNotDisabled(options)) {
            let cacheData = p1.useCacheFns.getCachedFnResult({ key: cacheKey });
            if (cacheData) {
              if (cacheDataValid({ options, cachedDateMS: cacheData.cachedDateMS })) {
                // Since we are within the acceptable cache window no need to run the actual function
                return;
              }
            }
          }

          try {
            let r1 = await p1.httpProcessor({ fnName: p1.fnName, payload: p });

            if (cacheExists) {
              p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: r1 });
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
