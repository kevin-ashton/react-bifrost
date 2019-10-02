# @bifrost

## Purpose

- Types end to end (front-end for registered functions)
- Types are implicitly inferred (no need to declare them in a separate files to have access in the front-end and back-end)
- Functions can be configured to execute on the server or locally
- A synchronous cache layer is supported at the function level (async is not supported because given the nature of react hooks it can impact performance)

## Notes

- Assumes functions have a single input parameter object
- The second parameter is an optional express.Request (used for auth if desired)
- Functions should throw errors. If desired the following interface can be used if you want to set a statusCode `{ statusCode: number, error: Error }`
- The express server assumes the body-parser exists
