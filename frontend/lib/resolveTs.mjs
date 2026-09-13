/* The window's modules import each other without an extension, the way the
 * bundler reads them, and node wants one. A unit test that imports this first
 * has a relative import that names no extension looked for as a .ts file.
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        /* not a TypeScript module: resolved as written, below */
      }
    }
    return next(specifier, context);
  },
});
