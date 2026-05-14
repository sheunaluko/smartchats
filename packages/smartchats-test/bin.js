#!/usr/bin/env node
// Thin entrypoint that re-exports the compiled CLI. Lets `bin` field in
// package.json work without users having to know about dist/.
import './dist/cli.js';
