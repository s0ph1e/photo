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

emitter.on('skipped', it => console.log(
	`skipped ${it.source.path} -> ${it.destination.path} (${it.source.size} -> ${it.destination.size})`.gray));
emitter.on('omitted', it => console.log(
	`omitted ${it.source.path} (no exif)`.yellow));
emitter.on('failed', it => console.error(
	`failed to copy ${it.source.path} due to ${it.error.stack}`.red));
emitter.on('succeeded', it => console.log(
	`copied ${it.source.path} -> ${it.destination.path}`.green));

importer({
	input: input || '.',
	output: output || '.',
	emitter
}).return(0).then(process.exit).catch(error => {
	console.error(`import stopped due to unexpected ${error.stack}`.red);
	process.exit(-1);
});
