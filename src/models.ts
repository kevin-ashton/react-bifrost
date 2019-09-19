export type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
export type ArgumentType<F extends Function> = F extends (arg: infer A) => any ? A : never;
export type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any;

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

export type UnpackBifrostSubscription<T> = T extends BifrostSubscription<infer U> ? U : T;

export type BifrostInstance<FunctionsType extends Record<string, Function>> = {
  [K in keyof FunctionsType]: BifrostInstanceFn<
    ArgumentType<FunctionsType[K]>,
    UnpackPromise<ReturnType<FunctionsType[K]>>
  >;
};

export interface UseCacheFns {
  getCachedFnResult: (p: { key: string }) => Promise<{ cachedDateMS: number; value: any } | void>;
  setCachedFnResult: (p: { key: string; value: any }) => Promise<void>;
}

export type SubProps<T> = {
  dispose: () => void;
  onData: (fn: (a: T) => void) => void;
  onError: (fn: (a: Error) => void) => void;
  nextData: (a: T, opts?: { ensureSequentialTimestamp?: number }) => void;
  nextError: (e: Error) => void;
};

export interface BifrostInstanceFn<ParamType, ResponseType> {
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

export type HttpProcessor = (p: { fnName: string; payload: any }) => Promise<any>;
export type Logger = (p: { fnName: string; details: any; error?: Error }) => any;

export interface HelperOptions {
  useCacheOnlyWithinMS?: number;
}
