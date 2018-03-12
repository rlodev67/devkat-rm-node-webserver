'use strict';

// Parse config.
require('dotenv').config();

/* Includes. */

const db = require('../inc/db.js').pool;
const utils = require('../inc/utils.js');
const debug = require('debug')('devkat:routes:raw_data');


/* Readability references. */

var isEmpty = utils.isEmpty;


/* Settings. */

const SCANNEDLOCATION_LIMIT_PER_QUERY = parseInt(process.env.SCANNEDLOCATION_LIMIT_PER_QUERY) || 50000;


/* Helpers. */

// Make sure SQL uses proper timezone.
const FROM_UNIXTIME = "CONVERT_TZ(FROM_UNIXTIME(?), @@session.time_zone, '+00:00')";
const TIMEDELTA = 15; //minutes

function prepareQueryOptions(options) {
    debug('Preparing query');
    // Parse options.
    var swLat = options.swLat;
    var swLng = options.swLng;
    var neLat = options.neLat;
    var neLng = options.neLng;
    var oSwLat = options.oSwLat;
    var oSwLng = options.oSwLng;
    var oNeLat = options.oNeLat;
    var oNeLng = options.oNeLng;
    var timestamp = options.timestamp || false;
    //var new_area = options.new_area;

    // Query options.
    var query_where = [];
    var orderBy = false;

    //ported from
    //https://github.com/SenorKarlos/RocketMap/blob/MIX_MEWTWO/pogom/models.py#L795
    if (timestamp) {
        //timestamp > 0
        query_where.push(
            [
                'last_modified > ' + FROM_UNIXTIME,
                [Math.round(timestamp / 1000)]
            ]
        );

        if (!isEmpty(swLat) && !isEmpty(swLng) && !isEmpty(neLat) && !isEmpty(neLng)) {
            query_where.push(
                [
                    'latitude >= ? AND latitude <= ?',
                    [swLat, neLat]
                ]
            );
            query_where.push(
                [
                    'longitude >= ? AND longitude <= ?',
                    [swLng, neLng]
                ]
            );
        }
    } else if (!isEmpty(oSwLat) && !isEmpty(oSwLng) && !isEmpty(oNeLat) && !isEmpty(oNeLng)) {
        //window was moved, get the new info
        query_where.push(
            [
                'last_modified > ' + FROM_UNIXTIME,
                [Math.round((Date.now() - TIMEDELTA * 60 * 1000) / 1000)]
            ]
        );

        if (!isEmpty(swLat) && !isEmpty(swLng) && !isEmpty(neLat) && !isEmpty(neLng)) {
            query_where.push(
                [
                    'latitude >= ? AND latitude <= ?',
                    [swLat, neLat]
                ]
            );
            query_where.push(
                [
                    'longitude >= ? AND longitude <= ?',
                    [swLng, neLng]
                ]
            );
        }

        if (!isEmpty(oSwLat) && !isEmpty(oSwLng) && !isEmpty(oNeLat) && !isEmpty(oNeLng)) {
            query_where.push(
                [
                    'NOT(last_modified > ' + FROM_UNIXTIME +' AND latitude < ? AND latitude > ? AND longitude < ? AND longitude > ?)',
                    [Math.round((Date.now() - TIMEDELTA * 60 * 1000) / 1000), oNeLat, oSwLat, oNeLng, oSwLng]
                    //[Math.round((Date.now() - TIMEDELTA * 60 * 1000) / 1000), oSwLat, oNeLat, oSwLng, oNeLng]
                ]
            );
        }
    } else {
        //no timestamp, new old locations... let's throw some data
        query_where.push(
            [
                'last_modified > ' + FROM_UNIXTIME,
                [Math.round((Date.now() - TIMEDELTA * 60 * 1000) / 1000)]
            ]
        );

        if (!isEmpty(swLat) && !isEmpty(swLng) && !isEmpty(neLat) && !isEmpty(neLng)) {
            query_where.push(
                [
                    'latitude >= ? AND latitude <= ?',
                    [swLat, neLat]
                ]
            );
            query_where.push(
                [
                    'longitude >= ? AND longitude <= ?',
                    [swLng, neLng]
                ]
            );
        }

        orderBy = true;
    }

    // Prepare query.
    let query = ' WHERE ';
    let partials = [];
    let values = []; // Unnamed query params.

    // Add individual options.
    for (var i = 0; i < query_where.length; i++) {
        let w = query_where[i];
        // w = [ 'query ?', [opt1] ]
        partials.push(w[0]);
        values = values.concat(w[1]);
    }
    query += partials.join(' AND ');

    if (orderBy) {
        query += ' ORDER BY last_modified ASC'
    }
    // Set limit.
    query += ' LIMIT ' + SCANNEDLOCATION_LIMIT_PER_QUERY;

    return [ query, values ];
}

function prepareScannedLocationPromise(query, params) {
    return new Promise((resolve, reject) => {
        db.query(query, params, (err, results, fields) => {
            if (err) {
                reject(err);
            } else {
                debug('Got %d scanned locations', results.length)
                // If there are no scannedlocations, let's just go. 👀
                if (results.length == 0) {
                    return resolve(results);
                }

                // Manipulate scannedlocations, destructive operations.
                for (var i = 0; i < results.length; i++) {
                    let location = results[i];

                    if (typeof location.last_modified !== 'string') { //to avoid the value being null...
                        continue;
                    }
                    // Avoid timezone issues. This is a UTC timestamp.
                    location.last_modified = location.last_modified.replace(' ', 'T') + 'Z';

                    // Convert datetime to UNIX timestamp.
                    location.last_modified = Date.parse(location.last_modified) || 0;

                    location.cellid = parseInt(location.cellid);
                    if (location.done == 1) {
                        location.done = true;
                    } else {
                        location.done = false;
                    }
                }

                return resolve(results);
            }
        });
    });
}


/* Model. */

const tablename = 'scannedlocation';
const ScannedLocation = {};

// Get active Pokéstops by coords or timestamp.
ScannedLocation.get_locations = (swLat, swLng, neLat, neLng, timestamp, oSwLat, oSwLng, oNeLat, oNeLng) => {
    // Prepare query.
    var query_where = prepareQueryOptions({
        'swLat': swLat,
        'swLng': swLng,
        'neLat': neLat,
        'neLng': neLng,
        'oSwLat': oSwLat,
        'oSwLng': oSwLng,
        'oNeLat': oNeLat,
        'oNeLng': oNeLng,
        'timestamp': timestamp
        //'new_area': new_area
    });

    //const query = 'SELECT * FROM ' + tablename + query_where[0];
    //const params = query_where[1];
    const query = 'SELECT * FROM ' + tablename + query_where[0];
    const params = query_where[1];

    // Return promise.
    return prepareScannedLocationPromise(query, params);
};

module.exports = ScannedLocation;
