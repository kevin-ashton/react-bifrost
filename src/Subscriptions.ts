import Emittery from 'emittery';
import { BifrostSubscription } from './models';
import _ from 'lodash';

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
