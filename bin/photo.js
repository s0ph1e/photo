#!/usr/bin/env node --use_strict --harmony --harmony_destructuring --harmony_array_includes

'use strict';

var EventEmitter = require('events').EventEmitter;
var importer = require('../lib/importer');
var colors = require('colors');

var input = process.argv[2];
var output = process.argv[3];

var emitter = new EventEmitter();

if (!input && !output) {
	console.error('neither input nor output path is specified'.red);
	console.log('usage: photo /path/to/import/from /path/to/import/to'.cyan);
	process.exit(-1);
}

emitter.on('skipped', it => console.log('skipped %s -> %s (%d -> %d)'.gray, it.source.path, it.destination.path, it.source.size, it.destination.size));
emitter.on('omitted', it => console.log('omitted %s (no exif)'.yellow, it.source.path));
emitter.on('failed', it => console.error('failed %s due to %s'.red, it.source.path, it.error.stack));
emitter.on('succeeded', it => console.log('copied %s -> %s'.green, it.source.path, it.destination.path));

importer({
	input: input || '.',
	output: output || '.',
	emitter: emitter
}).return(0).then(process.exit).catch(error => console.error(error.stack));
