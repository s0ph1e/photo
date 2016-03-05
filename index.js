#!/usr/bin/env node

'use strict';

var path = require('path');
var util = require('util');
var fs = require('fs');

var _ = require('lodash');
var Promise = require('bluebird');

var glob = require('glob');
var mkdirp = Promise.promisify(require('mkdirp'));
var stat = Promise.promisify(fs.stat);
var ExifImage = require('exif').ExifImage;
var colors = require('colors');

var input = process.argv[2];
var output = process.argv[3];

if (_.isEmpty(input) && _.isEmpty(output)) {
	console.error('neither input nor output path is specified'.red);
	console.log('usage: photo /path/to/import/from /path/to/import/to'.cyan);
	process.exit(-1);
}

if (_.isEmpty(input)) {
	input = '.';
} 

if (_.isEmpty(output)) {
	output = '.';
}

glob(path.join(input, '**/*.+(jpg|JPG)'))
	.on('match', handle)
	.on('error', fail);

function handle (source) {
	return getExif(source).then(function (exif) {
		return getDestinationFilename(output, exif);
	}).then(function (destination) {
		return mkdirp(path.dirname(destination)).then(function () {
			return isCopied(source, destination);
		}).then(function (copied) {
			if (!copied) {
				return copy(source, destination);
			} else {
				return false;
			}
		}).then(function (result) {
			if (result === false) {
				console.log('already processed %s -> %s'.yellow, source, destination);
			} else {
				console.log('processed %s -> %s'.green, source, destination);
			}
		});
	}).catch(function (error) {
		if (error.message.indexOf('Exif') === -1) {
			fail(error);
		} else {
			console.error('skipped %s'.gray, source);
		}
	});
}

function fail (error) {
	console.error('failed!'.red);
	console.error(error.stack.red);
	process.exit(-1);
}

function isCopied (source, destination) {
	return Promise.join(stat(source), stat(destination), function (sourceStat, destinationStat) {
		return destinationStat.isFile() && destinationStat.size >= sourceStat.size;
	}).catch(function (error) {
		if (error.code === 'ENOENT') {
			return false;
		} else {
			throw error;
		}
	});
}

function copy (source, destination) {
	return new Promise(function (resolve, reject) {
		var readable = fs.createReadStream(source);
		var writable = fs.createWriteStream(destination);
		readable.on('error', reject);
		writable.on('error', reject);
		writable.on('finish', resolve);
		readable.pipe(writable);
	});
}

function getExif (filename) {
	return new Promise(function (resolve, reject) {
		new ExifImage({ image: filename }, function (error, data) {
			if (error) {
				reject(error);
			} else {
				resolve(data);
			}
		});
	});
}

function getDestinationFilename (basename, exif) {
	if (!exif.image || !exif.image.ModifyDate || !exif.image.Make || !exif.image.Model) {
		throw new Error('Bad Exif');
	}
	var datetime = exif.image.ModifyDate.split(' ');
	var date = datetime[0].split(':');
	var time = datetime[1].split(':');
	var make = exif.image.Make.split(/\s+/);
	var model = exif.image.Model.split(/\s+/);
	var camera = _.uniq(make.concat(model)).join('-');
	return path.join(
		basename, 
		date[0], 
		util.format('%s-%s', date[1], date[2]),
		util.format('%s-%s-%s-%s.jpg', time[0], time[1], time[2], camera)
	);
}