'use strict';

// Parse config.
require('dotenv').config();

var S2 = require('s2-geometry').S2;
var s2_level = 10;

var lat_delta = 0.15;
var lng_delta = 0.4;


/* Includes. */

const db = require('../inc/db.js').pool;
const utils = require('../inc/utils.js');


/* Readability references. */

var isEmpty = utils.isEmpty;


/* Settings. */

const WEATHER_LIMIT_PER_QUERY = parseInt(process.env.WEATHER_LIMIT_PER_QUERY) || 5000;


/* Helpers. */

// Make sure SQL uses proper timezone.
const FROM_UNIXTIME = "CONVERT_TZ(FROM_UNIXTIME(?), @@session.time_zone, '+00:00')";

function prepareQueryOptions(options) {
    // Parse options.
    var swLat = options.swLat - lat_delta;
    var swLng = options.swLng - lng_delta;
    var neLat = options.neLat - lat_delta;
    var neLng = options.neLng - lng_delta;
    var oSwLat = options.oSwLat- lat_delta;
    var oSwLng = options.oSwLng - lng_delta;
    var oNeLat = options.oNeLat- lat_delta;
    var oNeLng = options.oNeLng - lng_delta;
    var alerts = options.weather_alerts;
    var timestamp = options.timestamp || false;

    // Query options.
    var query_where = [];

    // Optional viewport.
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

    if (timestamp) {
        // Change POSIX timestamp to UTC time.
        timestamp = new Date(timestamp).getTime();

        query_where.push(
            [
                'last_updated > ' + FROM_UNIXTIME,
                [Math.round(timestamp / 1000)]
            ]
        );

        // Send weather in view but exclude those within old boundaries.
        // Don't use when timestamp is empty, it means we're intentionally trying to get
        // old weather as well (new viewport or first request).
        if (!isEmpty(oSwLat) && !isEmpty(oSwLng) && !isEmpty(oNeLat) && !isEmpty(oNeLng)) {
            query_where.push(
                [
                    'latitude < ? AND latitude > ? AND longitude < ? AND longitude > ?',
                    [oSwLat, oNeLat, oSwLng, oNeLng]
                ]
            );
        }
    }

    // Alerts enabled/disabled
    if (alerts) {
        query_where.push(
            [
                'severity > 0',
                []
            ]
        );
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
    query += ' LIMIT ' + POKESTOP_LIMIT_PER_QUERY;

    return [ query, values ];
}

//TODO: format data to work as RESPONSE
function prepareWeatherPromise(query, params) {
    return new Promise((resolve, reject) => {
        db.query(query, params, (err, results, fields) => {
            if (err) {
                reject(err);
            } else {
                // If there is no weather, let's just go. 👀
                if (results.length == 0) {
                    return resolve(results);
                }

                // Manipulate weather, destructive operations.
                for (var i = 0; i < results.length; i++) {
                    let weather = results[i];

                    // Avoid timezone issues. This is a UTC timestamp.
                    weather.last_updated = pokestop.last_updated.replace(' ', 'T') + 'Z';

                    // Convert datetime to UNIX timestamp.
                    weather.last_updated = Date.parse(pokestop.last_updated) || 0;
                }

                return resolve(results);
            }
        });
    });
}


/* Model. */

const tablename = 'weather';
const Weather = {};

// Get active Pokéstops by coords or timestamp.
Weather.get_weather = (swLat, swLng, neLat, neLng, timestamp, oSwLat, oSwLng, oNeLat, oNeLng, weather_alerts) => {
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
        'weather_alerts' : weather_alerts,
        'timestamp': timestamp
    });

    const query = 'SELECT * FROM ' + tablename + query_where[0];
    const params = query_where[1];

    // Return promise.
    return prepareWeatherPromise(query, params);
};

module.exports = Weather;
