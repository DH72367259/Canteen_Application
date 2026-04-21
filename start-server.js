#!/usr/bin/env node

const path = require('path');

process.chdir(__dirname);

// Set required environment variables
process.env.PORT = process.env.PORT || 3000;
process.env.NODE_ENV = 'production';

// Load the Next.js standalone server
require('./.next/standalone/server.js');
