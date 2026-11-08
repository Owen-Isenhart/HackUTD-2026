// Lets Node's test runner load the app's TypeScript files. The app imports './geo' without
// an extension (the Expo bundler adds it); Node needs '.ts', so this adds it when missing.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !specifier.endsWith('.ts')) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});
