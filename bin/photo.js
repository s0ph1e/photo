#!/usr/bin/env node

'use strict';

const EventEmitter = require('events').EventEmitter;
const importer = require('../lib/importer');
const colors = require('colors');
const path = require('path');

const input = process.argv[2];
const output = process.argv[3];

const emitter = new EventEmitter();

if (!input && !output) {
	console.error('neither input nor output path is specified'.red);
	console.log('usage: photo /path/to/import/from /path/to/import/to'.cyan);
	process.exit(-1);
}

emitter.on('skipped', it => console.log(
	`skipped ${it.source.path} -> ${it.destination.path} (${it.source.size} -> ${it.destination.size})`.gray));
emitter.on('omitted', it => console.log(
	`copied ${it.source.path} -> ${it.destination.path} (${it.error.message})`.yellow));
emitter.on('failed', it => console.error(
	`failed to copy ${it.source.path} due to ${it.error.stack}`.red));
emitter.on('succeeded', it => console.log(
	`copied ${it.source.path} -> ${it.destination.path}`.green));

importer({
	input: input || '.',
	output: output || '.',
	noExif: path.join(output, 'no-exif'),
	other: path.join(output, 'other'),
	emitter
}).return(0).then(process.exit).catch(error => {
	console.error(`import stopped due to unexpected ${error.stack}`.red);
	process.exit(-1);
});
