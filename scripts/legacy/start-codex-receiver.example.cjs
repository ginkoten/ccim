"use strict";
// Historical terminal launcher; not an application receiver entry point.
const { runReceiver } = require("./project-receiver.cjs");
try { process.exitCode = runReceiver("codex"); }
catch (error) { console.error(error.message); process.exitCode = 1; }
