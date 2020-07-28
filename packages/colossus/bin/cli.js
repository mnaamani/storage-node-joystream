#!/usr/bin/env node
'use strict';

// Node requires
const path = require('path');

// npm requires
const meow = require('meow');
const configstore = require('configstore');
const chalk = require('chalk');
const figlet = require('figlet');
const _ = require('lodash');

const debug = require('debug')('joystream:cli');

// Project root
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Configuration (default)
const pkg = require(path.resolve(PROJECT_ROOT, 'package.json'));
const default_config = new configstore(pkg.name);

// Parse CLI
const FLAG_DEFINITIONS = {
  port: {
    type: 'integer',
    alias: 'p',
    _default: 3000,
  },
  'syncPeriod': {
    type: 'integer',
    _default: 120000,
  },
  config: {
    type: 'string',
    alias: 'c',
  },
  'wsProvider': {
    type: 'string',
    _default: 'ws://localhost:9944'
  }
};

const cli = meow(`
  Usage:
    $ colossus [command] [options]

  Commands:
    leacher [default]       Runs a leacher!

  Options:
    --config=PATH, -c PATH  Configuration file path. Defaults to
                            "${default_config.path}".
    --port=PORT, -p PORT    Port number to listen on, defaults to 3000.
    --sync-period           Number of milliseconds to wait between synchronization
                            runs. Defaults to 30,000 (30s).
    --ws-provider           Joystream Node websocket provider url, eg: "ws://127.0.0.1:9944"
  `,
  { flags: FLAG_DEFINITIONS });

// Create configuration
function create_config(pkgname, flags)
{
  // Create defaults from flag definitions
  const defaults = {};
  for (var key in FLAG_DEFINITIONS) {
    const defs = FLAG_DEFINITIONS[key];
    if (defs._default) {
      defaults[key] = defs._default;
    }
  }

  // Provide flags as defaults. Anything stored in the config overrides.
  var config = new configstore(pkgname, defaults, { configPath: flags.config });

  // But we want the flags to also override what's stored in the config, so
  // set them all.
  for (var key in flags) {
    // Skip aliases and self-referential config flag
    if (key.length == 1 || key === 'config') continue;
    // Skip sensitive flags
    if (key == 'passphrase') continue;
    // Skip unset flags
    if (!flags[key]) continue;
    // Otherwise set.
    config.set(key, flags[key]);
  }

  debug('Configuration at', config.path, config.all);
  return config;
}

// All-important banner!
function banner()
{
  console.log(chalk.blue(figlet.textSync('joystream', 'Speed')));
}

// Get an initialized storage instance
function get_storage(runtime_api, config)
{
  // TODO at some point, we can figure out what backend-specific connection
  // options make sense. For now, just don't use any configuration.
  const { Storage } = require('@joystream/storage');

  const options = {
    resolve_content_id: async (content_id) => {
      // Resolve via API
      const obj = await runtime_api.assets.getDataObject(content_id);
      if (!obj || obj.isNone) {
        return;
      }

      return obj.unwrap().ipfs_content_id.toString();
    },
  };

  return Storage.create(options);
}

async function createApi(config)
{
  // Load key information
  const { RuntimeApi } = require('@joystream/runtime-api');

  const wsProvider = config.get('wsProvider');

  const api = await RuntimeApi.create({
    provider_url: wsProvider,
  });

  return api
}

// Simple CLI commands
var command = cli.input[0];
if (!command) {
  command = 'server';
}

const commands = {
  'leacher': async () => {
    const cfg = create_config(pkg.name, cli.flags);
    const api = await createApi(cfg);
    const store = get_storage(api, cfg);
    console.log('Leacher Mode Started!')
    const { start_syncing } = require('../lib/sync');
    start_syncing(api, cfg, store);
    
    return new Promise(() => {})
  }
};

async function main()
{
  // Simple CLI commands
  var command = cli.input[0];
  if (!command) {
    command = 'leacher';
  }

  if (commands.hasOwnProperty(command)) {
    // Command recognized
    const args = _.clone(cli.input).slice(1);
    await commands[command](...args);
  }
  else {
    throw new Error(`Command "${command}" not recognized, aborting!`);
  }
}

main()
  .then(() => {
    console.log('Process exiting gracefully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error(chalk.red(err.stack));
    process.exit(-1);
  });
