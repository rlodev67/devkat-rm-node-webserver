'use strict';

// Parse config.
require('dotenv').config();

/* Includes. */

const db = require('../inc/db.js').pool;
const utils = require('../inc/utils.js');
const debug = require('debug')('devkat:models:Spawnpoint');


/* Readability references. */

var isEmpty = utils.isEmpty;


/* Settings. */

const SPAWNPOINT_LIMIT_PER_QUERY = parseInt(process.env.SPAWNPOINT_LIMIT_PER_QUERY) || 50000;


/* Helpers. */

String.prototype.count=function(s1) {
    let count = 0;
    for (let i = 0; i < this.length; i++) {
        if (this.charAt(i) === s1) {
            count++;
        }
    }
    return count;
}

// https://stackoverflow.com/questions/4467539/javascript-modulo-gives-a-negative-result-for-negative-numbers
function mod(n, m) {
    return ((n % m) + m) % m;
}

// Make sure SQL uses proper timezone.
const FROM_UNIXTIME = "CONVERT_TZ(FROM_UNIXTIME(?), @@session.time_zone, '+00:00')";

function prepareQueryOptions(options) {
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

    if (timestamp) {
        //timestamp > 0
        query_where.push(
            [
                'sp.last_scanned > ' + FROM_UNIXTIME,
                [Math.round(timestamp / 1000)]
            ]
        );

        if (!isEmpty(swLat) && !isEmpty(swLng) && !isEmpty(neLat) && !isEmpty(neLng)) {
            query_where.push(
                [
                    'sp.latitude >= ? AND sp.latitude <= ?',
                    [swLat, neLat]
                ]
            );
            query_where.push(
                [
                    'sp.longitude >= ? AND sp.longitude <= ?',
                    [swLng, neLng]
                ]
            );
        }
    } else if (!isEmpty(oSwLat) && !isEmpty(oSwLng) && !isEmpty(oNeLat) && !isEmpty(oNeLng)) {
        //window was moved, get the new info
        if (!isEmpty(swLat) && !isEmpty(swLng) && !isEmpty(neLat) && !isEmpty(neLng)) {
            query_where.push(
                [
                    'sp.latitude >= ? AND sp.latitude <= ?',
                    [swLat, neLat]
                ]
            );
            query_where.push(
                [
                    'sp.longitude >= ? AND sp.longitude <= ?',
                    [swLng, neLng]
                ]
            );
        }

        if (!isEmpty(oSwLat) && !isEmpty(oSwLng) && !isEmpty(oNeLat) && !isEmpty(oNeLng)) {
            query_where.push(
                [
                    'NOT(sp.latitude < ? AND sp.latitude > ? AND sp.longitude < ? AND sp.longitude > ?)',
                    [oNeLat, oSwLat, oNeLng, oSwLng]
                ]
            );
        }
    } else {
        if (!isEmpty(swLat) && !isEmpty(swLng) && !isEmpty(neLat) && !isEmpty(neLng)) {
            query_where.push(
                [
                    'sp.latitude >= ? AND sp.latitude <= ?',
                    [swLat, neLat]
                ]
            );
            query_where.push(
                [
                    'sp.longitude >= ? AND sp.longitude <= ?',
                    [swLng, neLng]
                ]
            );
        }
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
    // Set limit.
    query += ' LIMIT ' + SPAWNPOINT_LIMIT_PER_QUERY;
    return [ query, values ];
}

//https://github.com/SenorKarlos/RocketMap/blob/MIX_MEWTWO/pogom/models.py#L1343
function calculateStartEndTimeOfSpawnpoint(sp, spawn_delay = 0, links = false) {
    let links_arg = links;
    if (links == false) {
        links = sp["links"];
    }

    if (links.count('-') == 0) {
        links = links.replace(/.$/,"-");
    }

    links = links.replace(/\?/g, '\+');

    links = links.replace(/.$/,"-");
    let plus_or_minus = "";
    if (links.count('+') > 0) {
        plus_or_minus = links.indexOf('+');
    } else {
        plus_or_minus = links.indexOf('-');
    }

    let start = sp["earliest_unseen"] - (4 - plus_or_minus) * 900 + spawn_delay;
    let no_tth_adjust = 0;
    if (!links_arg && !tthFound(sp)) {
        no_tth_adjust = 60;
    }
    let end = sp["latest_seen"] - (3 - links.indexOf('-')) * 900 + no_tth_adjust;

    start = mod(start, 3600);
    end = mod(end, 3600);
    return [start, end];
}

function tthFound(sp) {
    let latest_seen = mod(sp["latest_seen"], 3600);
    let earliest_unseen = mod(sp["earliest_unseen"], 3600);
    return latest_seen - earliest_unseen == 0;
}

function prepareSpawnpointPromise(query, params) {
    return new Promise((resolve, reject) => {
        db.query(query, params, (err, results, fields) => {
            if (err) {
                reject(err);
            } else {
                // If there are no spawnpoints, let's just go. 👀
                if (results.length == 0) {
                    debug('No spawnpoints to be processed')
                    return resolve(results);
                }

                // Manipulate spawnpoints, destructive operations.
                for (var i = 0; i < results.length; i++) {
                    let sp = results[i];

                    let processed_sp = {};
                    if (typeof sp.last_scanned !== 'string') { //to avoid the value being null...
                        continue;
                    }
                    // Avoid timezone issues. This is a UTC timestamp.
                    sp.last_scanned = sp.last_scanned.replace(' ', 'T') + 'Z';

                    // Convert datetime to UNIX timestamp.
                    sp.last_scanned = Date.parse(sp.last_scanned) || 0;
                    let startEnd = calculateStartEndTimeOfSpawnpoint(sp);

                    processed_sp["id"] = sp["id"];
                    processed_sp["disappear_time"] = startEnd[1];
                    processed_sp["appear_time"] = startEnd[0];
                    if (tthFound(sp) == false || sp['done'] == 0) {
                        processed_sp["uncertain"] = true;
                    }
                    processed_sp["latitude"] = sp["latitude"];
                    processed_sp["longitude"] = sp["longitude"];

                    results[i] = processed_sp;
                }
                debug('Processed %d spawnpoints', results.length)
                return resolve(results);
            }
        });
    });
}


/* Model. */

const tablename = 'spawnpoint sp';
const Spawnpoint = {};

// Get active Pokéstops by coords or timestamp.
Spawnpoint.get_locations = (swLat, swLng, neLat, neLng, timestamp, oSwLat, oSwLng, oNeLat, oNeLng) => {
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
    });

    const joins = ' LEFT JOIN scanspawnpoint ssp ON ssp.spawnpoint_id = sp.id '
    + 'LEFT JOIN scannedlocation sl ON sl.cellid = ssp.scannedlocation_id '
    const query = 'SELECT sp.*, sl.done FROM ' + tablename + joins + query_where[0];
    const params = query_where[1];

    // Return promise.
    return prepareSpawnpointPromise(query, params);
};

module.exports = Spawnpoint;
