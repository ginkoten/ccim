"use strict";
// Install beside ccim-project-receiver.cjs and the verified ccim-macos-proxy.cjs runtime copy.
const { runReceiver } = require("./ccim-project-receiver.cjs");
try { process.exitCode = runReceiver("claude"); }
catch (error) { console.error(error.message); process.exitCode = 1; }
