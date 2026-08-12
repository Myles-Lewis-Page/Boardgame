// Express 4 has no built-in way to catch errors thrown inside an async
// route handler. Without this wrapper, an unhandled rejection in an async
// handler (e.g. a Postgres query against a column that doesn't exist yet)
// never sends a response at all - the request just hangs until the
// platform's own timeout kicks in, which on Railway shows up as
// "Application failed to respond" for every request that hits that route,
// making the whole app look down even though only one query is broken.
//
// This wraps a handler so any thrown/rejected error is passed to next(err),
// which routes it to the error-handling middleware in server.js and
// guarantees an actual HTTP response goes out instead of a silent hang.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
