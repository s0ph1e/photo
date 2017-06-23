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

const ERRORS = {
	badExif: 'bad exif',
	notPhoto: 'not a photo'
};

module.exports = function (options) {
	const output = options.output;
	const other = options.other;
	const noExif = options.noExif;
	const emitter = options.emitter || new EventEmitter();

	return walk(options.input);

	function walk(sourcePath) {
		return readdir(sourcePath)
			.catch({code: 'EACCES'}, error => [])
			.then(entries => entries.map(it => path.join(sourcePath, it)))
			.map(classify, {concurrency})
			.then(entries => {
				const directories = entries.filter(it => it.isDirectory).map(it => it.path);
				const files = entries.filter(it => it.isFile).map(it => ({path: it.path, size: it.size}));
				return Promise
					.resolve(files)
					.map(understand, {concurrency})
					.map(execute, {concurrency})
					.return(directories)
					.map(walk, {concurrency: 1});
			});
	}

	function understand(source) {
		return getDestination(source)
			.then(destination => ({source, destination, command: source.size > destination.size ? 'copy' : 'skip'}))
			.catch(error => ({source, error, destination: getErroredFilename(source, error),
				command: [ERRORS.badExif, ERRORS.notPhoto].includes(error.message) ? 'omit' : 'fail'}));
	}

	function execute(it) {
		var command = it.command;
		delete it.command;
		switch (command) {
			case 'fail':
				return emitter.emit('failed', it);
			case 'omit':
				return mkdirp(path.dirname(it.destination.path))
					.then(() => pipe(it.source.path, it.destination.path))
					.then(() => emitter.emit('omitted', it));
			case 'skip':
				return emitter.emit('skipped', it);
			case 'copy':
				return pipe(it.source.path, it.destination.path)
					.then(() => emitter.emit('succeeded', it));
			default:
				throw new Error('Unknown command!');
		}
	}

	function getDestination(source) {
		const isPhoto = /\.(jpg|JPG)$/.test(source.path);
		if (!isPhoto) {
			return Promise.reject(new Error(ERRORS.notPhoto));
		}

		return exif.read(source.path, 16).then(exif => {
			if (!exif || !exif.image || !exif.image.ModifyDate || !exif.image.Make || !exif.image.Model) {
				throw new Error(ERRORS.badExif);
			}
			const filaname = getFilename(exif);
			return path.join(output, filaname);
		}).then((destinationPath) => {
			return Promise.join(
				mkdirp(path.dirname(destinationPath)),
				stat(destinationPath)
					.then(info => ({path: destinationPath, size: info.size}))
					.catch({code: 'ENOENT'}, error => ({path: destinationPath, size: 0})),
				(it, info) => info
			)
		});
	}

	function getErroredFilename (it, error) {
		const filename = path.basename(it.path);
		const dirname = {
				[ERRORS.notPhoto]: other,
				[ERRORS.badExif]: noExif
			}[error.message] || 'unknown';
		const filepath = path.join(dirname, filename);

		return {path: filepath};
	}
};

function classify (entryPath) {
	return stat(entryPath)
		.then(info => ({
			path: entryPath,
			isDirectory: info.isDirectory(),
			isFile: info.isFile(),
			size: info.size
		}))
		.catch({ code: 'ENOENT' }, error => ({}))
		.catch({ code: 'EACCES' }, error => ({}))
		.catch({ code: 'ELOOP' }, error => ({}));
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

function getFilename (exif) {
	const originalDate = exif.exif && exif.exif.DateTimeOriginal;
	const modifyDate = exif.image.ModifyDate;
	const date = originalDate || modifyDate;
	const make = exif.image.Make.split(/\s+/);
	const model = exif.image.Model.split(/\s+/);
	const camera = uniq(make.concat(model)).join('-').replace(/[^\w\d\-]+/g, '');
	const year = date.getFullYear().toString();
	const month = lpadz(date.getMonth() + 1);
	const day = lpadz(date.getDate());
	const hours = lpadz(date.getHours());
	const minutes = lpadz(date.getMinutes());
	const seconds = lpadz(date.getSeconds());
	return util.format('%s-%s-%s-%s-%s-%s-%s.jpg', year, month, day, hours, minutes, seconds, camera);
}
