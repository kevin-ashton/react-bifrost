import * as _ from 'lodash';

export function isSerializable(obj): boolean {
  var isNestedSerializable;
  function isPlain(val) {
    return (
      typeof val === 'undefined' ||
      typeof val === 'string' ||
      typeof val === 'boolean' ||
      typeof val === 'number' ||
      Array.isArray(val) ||
      _.isPlainObject(val)
    );
  }
  if (!isPlain(obj)) {
    return false;
  }
  for (var property in obj) {
    if (obj.hasOwnProperty(property)) {
      if (!isPlain(obj[property])) {
        return false;
      }
      if (typeof obj[property] == 'object') {
        isNestedSerializable = isSerializable(obj[property]);
        if (!isNestedSerializable) {
          return false;
        }
      }
    }
  }
  return true;
}
