// Backward-compatible entry point. Keep the canonical implementation in scripts/.
// This prevents the root-level script from resolving source files one directory
// above the repository when someone runs `node sync-frontend.js` directly.
import './scripts/sync-frontend.js';
