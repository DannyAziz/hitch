// `node --test installer/test/` resolves a directory argument to its
// index.js, so this file re-exports the spec modules for that invocation.
// The specs also run directly via `node --test installer/test/*.spec.mjs`.

import './detect.spec.mjs'
import './settings.spec.mjs'
import './apply.spec.mjs'
