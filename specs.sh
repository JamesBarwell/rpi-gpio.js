#!/usr/bin/env bash

echo "Running all tests located in the spec directory"
node node_modules/jasmine-node/lib/jasmine-node/cli.js --test-dir spec/ $1
