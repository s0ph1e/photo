'use strict';

var path = require('path');
var util = require('util');
var fs = require('fs');

var Promise = require('bluebird');

var EventEmitter = require('events').EventEmitter;
var ExifImage = require('exif').ExifImage;

var readdir = Promise.promisify(fs.readdir);
var stat = Promise.promisify(fs.stat);
var mkdirp = Promise.promisify(require('mkdirp'));

module.exports = function (options) {
	var output = options.output;
	var emitter = options.emitter || new EventEmitter();

	return walk(options.input);

	function walk (sourcePath) {
		return readdir(sourcePath)
			.then(entries => entries.map(it => path.join(sourcePath, it)))
			.map(classify, { concurrency: 100 })
			.then(entries => {
				var directories = entries.filter(it => it.isDirectory).map(it => it.path);
				var files = entries.filter(it => it.isFile).map(it => ({ path: it.path, size: it.size }));
				return Promise
					.resolve(files)
					.map(understand, { concurrency: 100 })
					.map(execute, { concurrency: 100 })
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
		return getExif(source.path)
			.then(exif => {
				if (!exif.image || !exif.image.ModifyDate || !exif.image.Make || !exif.image.Model) {
					throw new Error('Bad Exif!');
				}
				var datetime = exif.image.ModifyDate.split(' ');
				var date = datetime[0].split(':');
				var time = datetime[1].split(':');
				var make = exif.image.Make.split(/\s+/);
				var model = exif.image.Model.split(/\s+/);
				var camera = uniq(make.concat(model)).join('-').replace(/[^\w\d\-]+/g, '');
				return path.join(
					output,
					date[0],
					util.format('%s-%s', date[1], date[2]),
					util.format('%s-%s-%s-%s.jpg', time[0], time[1], time[2], camera)
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
	return stat(entryPath).then(info => ({
		path: entryPath,
		isDirectory: info.isDirectory(),
		isFile: info.isFile() && /\.(jpg|JPG)$/.test(entryPath),
		size: info.size
	}));
}

function getExif (filename) {
	return new Promise(function (resolve, reject) {
		new ExifImage(
			{ image: filename },
			(error, data) => error ? reject(error) : resolve(data)
		);
	});
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
