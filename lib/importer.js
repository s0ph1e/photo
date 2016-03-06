'use strict';

var path = require('path');
var util = require('util');
var fs = require('fs');

var Promise = require('bluebird');
var exif = require('fast-exif');

var EventEmitter = require('events').EventEmitter;

var readdir = Promise.promisify(fs.readdir);
var stat = Promise.promisify(fs.stat);
var mkdirp = Promise.promisify(require('mkdirp'));

var concurrency = require('os').cpus().length*2;

module.exports = function (options) {
	var output = options.output;
	var emitter = options.emitter || new EventEmitter();

	return walk(options.input);

	function walk (sourcePath) {
		return readdir(sourcePath)
			.catch({ code: 'EACCES' }, error => [])
			.then(entries => entries.map(it => path.join(sourcePath, it)))
			.map(classify, { concurrency })
			.then(entries => {
				var directories = entries.filter(it => it.isDirectory).map(it => it.path);
				var files = entries.filter(it => it.isFile).map(it => ({ path: it.path, size: it.size }));
				return Promise
					.resolve(files)
					.map(understand, { concurrency })
					.map(execute, { concurrency })
					.return(directories)
					.map(walk, { concurrency: 1 });
			});
	}

	function understand (source) {
		return getDestination(source)
			.then(destination => ({ source, destination, command: source.size > destination.size ? 'copy' : 'skip' }))
			.catch(error => ({ source, error, command: error.message.includes('Exif') ? 'omit' : 'fail' }));
	}

	function execute (it) {
		var command = it.command;
		delete it.command;
		switch (command) {
			case 'fail': return emitter.emit('failed', it);
			case 'omit': return emitter.emit('omitted', it);
			case 'skip': return emitter.emit('skipped', it);
			case 'copy': return pipe(it.source.path, it.destination.path)
				.then(() => emitter.emit('succeeded', it));
			default: throw new Error('Unknown command!');
		}
	}

	function getDestination (source) {
		return exif.read(source.path)
			.then(exif => {
				if (!exif || !exif.image || !exif.image.ModifyDate || !exif.image.Make || !exif.image.Model) {
					throw new Error('Bad Exif!');
				}
				var date = exif.image.ModifyDate;
				var make = exif.image.Make.split(/\s+/);
				var model = exif.image.Model.split(/\s+/);
				var camera = uniq(make.concat(model)).join('-').replace(/[^\w\d\-]+/g, '');
				return path.join(
					output,
					date.getFullYear().toString(),
					util.format('%s-%s', lpadz(date.getMonth() + 1), lpadz(date.getDate())),
					util.format('%s-%s-%s-%s.jpg', lpadz(date.getHours()), lpadz(date.getMinutes()), lpadz(date.getSeconds()), camera)
				);
			})
			.then(destinationPath => 
				Promise.join(
					mkdirp(path.dirname(destinationPath)),
					stat(destinationPath)
						.then(info => ({ path: destinationPath, size: info.size }))
						.catch({ code: 'ENOENT' }, error => ({ path: destinationPath, size: 0 })),
					(it, info) => info
				)
			);
	}
};

function classify (entryPath) {
	return stat(entryPath)
		.then(info => ({
			path: entryPath,
			isDirectory: info.isDirectory(),
			isFile: info.isFile() && /\.(jpg|JPG)$/.test(entryPath),
			size: info.size
		}))
		.catch({ code: 'ENOENT' }, error => ({}))
		.catch({ code: 'EACCES' }, error => ({}));
}

function pipe (sourceFilename, destinationFilename) {
	return new Promise(function (resolve, reject) {
		var readable = fs.createReadStream(sourceFilename);
		readable.on('error', reject);

		var writable = fs.createWriteStream(destinationFilename);
		writable.on('error', reject);
		writable.on('finish', resolve);
		
		readable.pipe(writable);
	});
}

function uniq (items) {
	var known = {}, unique = [];
	for (var i = 0, l = items.length; i < l; ++i) {
		if (known[items[i]]) {
			continue;
		}
		known[items[i]] = true;
		unique.push(items[i]);
	}
	return unique;
}

function lpadz (it) {
	it = it.toString();
	return it.length === 1 ? '0' + it : it;
}
