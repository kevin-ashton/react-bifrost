import { UseCacheFns, HttpProcessor, Logger, BifrostInstance, BifrostInstanceFn, HelperOptions } from './models';
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
  const cacheWindowExists = (options: HelperOptions) => {
    return options && options.useCacheOnlyWithinMS
  }

  const cacheNotDisabled = (options: HelperOptions) => {
    return !(options && options.disableCache)
  }


  return {
    getClientSubscription: (p: ParamType) => {
      return {
        subscribe: (fn) => {
          let sub = p1.fn(p);
          if (sub.then) {
            let msg =
              'It appears the function that is supposed to be returning a BifrostSubscription is returning a promise. This is not allowed. Can cause various race conditions when components unmount ';
            console.error(msg);
            throw new Error(msg);
          }

          if (!(!!sub.dispose && !!sub.nextData && !!sub.nextError && !!sub.onData && !!sub.onError)) {
            let msg =
              'getClientSubscription may only be called on functions that return a BifrostSubscription or something with a similar shape';
            console.error(msg);
            throw new Error(msg);
          }

          let cacheKey = `getClientSubscription-${p1.fnName}-${md5(jsonStableStringify(p))}`;
          if (cacheExists) {
            setTimeout(async () => {
              let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
              if (cacheData) {
                fn({ data: cacheData.value, isFromCache: true });
              }
            }, 0);
          }

          sub.onData((val) => {
            if (cacheExists) {
              p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: val }).catch((e) => console.error(e));
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

      let cacheKey = `fetchClient-${p1.fnName}-${md5(jsonStableStringify(p))}`;
      // We only check the cache if they have specified a useCacheOnlyWithinMS since it is a fetch
      if (cacheExists && cacheWindowExists(options) && cacheNotDisabled(options)) {
        let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
        if (cacheData) {
          if (cacheDataValid({ options, cachedDateMS: cacheData.cachedDateMS })) {
            return {
              data: cacheData.value,
              isFromCache: true
            };
          }
        }
      }

      try {
        let r = await p1.fn(p);
        if (cacheExists) {
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
          if (loggerExists) {
            p1.logger({ fnName: p1.fnName, details: { type: 'useClient', payload: p } });
          }

          let cacheKey = `useClient-${p1.fnName}-${md5(jsonStableStringify(p))}`;
          if (cacheExists && cacheNotDisabled(options)) {
            let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
            if (cacheData) {
              ref.current = { data: cacheData.value, isLoading: false, error: null, isFromCache: true };
              if (!hasUnmounted) {
                setTriggerRender((s) => !s);
              }
              if (cacheDataValid({ options, cachedDateMS: cacheData.cachedDateMS })) {
                // Since we are within the acceptable cache window
                return;
              }
            }
          }

          try {
            let r = await p1.fn(p);

            // Cache for the local useFunction
            if (cacheExists) {
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
            if (cacheExists) {
              let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
              if (cacheData) {
                ref.current = { data: cacheData.value, isLoading: false, error: null, isFromCache: true };
                if (!hasUnmounted) {
                  setTriggerRender((s) => !s);
                }
              }
            }

            sub.onData((val) => {
              if (cacheExists) {
                p1.useCacheFns.setCachedFnResult({ key: cacheKey, value: val }).catch((e) => console.error(e));
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

      let cacheKey = `fetchServer-${p1.fnName}-${md5(jsonStableStringify(p))}`;
      if (cacheExists && cacheWindowExists(options) && cacheNotDisabled(options)) {
        let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
        if (cacheData) {
          if (cacheDataValid({ options, cachedDateMS: cacheData.cachedDateMS })) {
            return {
              data: cacheData.value,
              isFromCache: true
            };
          }
        }
      }

      try {
        let r = await p1.httpProcessor({ fnName: p1.fnName, payload: p });
        if (cacheExists) {
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

          if (loggerExists) {
            p1.logger({ fnName: p1.fnName, details: { type: 'useServer', payload: p } });
          }

          let cacheKey = `server-${p1.fnName}-${md5(jsonStableStringify(p))}`;
          if (cacheExists && cacheNotDisabled(options)) {
            let cacheData = await p1.useCacheFns.getCachedFnResult({ key: cacheKey });
            if (cacheData) {
              ref.current = { data: cacheData.value, isLoading: false, error: null, isFromCache: true };
              if (!hasUnmounted) {
                setTriggerRender((s) => !s);
              }
              if (cacheDataValid({ options, cachedDateMS: cacheData.cachedDateMS })) {
                // Since we are within the acceptable cache window
                return;
              }
            }
          }

          try {
            let r1 = await p1.httpProcessor({ fnName: p1.fnName, payload: p });

            if (cacheExists) {
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

function cacheDataValid({ options, cachedDateMS }: { options: HelperOptions; cachedDateMS: number }): boolean {
  let cutoff = Date.now() - options.useCacheOnlyWithinMS;
  return cachedDateMS > cutoff;
}
