'use strict';

// Parse config.
require('dotenv').config();
const debug = require('debug')('devkat:routes:raw_data');

var S2 = require('s2-geometry').S2;
var s2_level = 10;

/* Includes. */

const db = require('../inc/db.js').pool;
const utils = require('../inc/utils.js');


//cache of the latest weather
var latestWeather = {}

/* Readability references. */

var isEmpty = utils.isEmpty;


/* Settings. */

const WEATHER_LIMIT_PER_QUERY = parseInt(process.env.WEATHER_LIMIT_PER_QUERY) || 5000;


/* Helpers. */

// Make sure SQL uses proper timezone.
const FROM_UNIXTIME = "CONVERT_TZ(FROM_UNIXTIME(?), @@session.time_zone, '+00:00')";

function prepareQueryOptions() {
    // Parse options.
    var weather_alerts = options.weather_alerts;
    var timestamp = options.timestamp || false;

    // Prepare query.
    let query = '';

    // Set limit.
    query += ' LIMIT ' + WEATHER_LIMIT_PER_QUERY;
    return query;
}

//TODO: format data to work as RESPONSE
function prepareWeatherPromise(query) {
    return new Promise((resolve, reject) => {
        db.query(query, (err, results, fields) => {
            if (err) {
                reject(err);
            } else {

                // If there is no weather, let's just go. 👀
                if (results.length == 0) {
                    return resolve(results);
                }

                // Manipulate weather, destructive operations.
                //gotta add vertices array and center object
                for (var i = 0; i < results.length; i++) {
                    let weather = results[i];

                    weather.vertices = S2.S2Cell.FromLatLng({
                      'lat' : weather.latitude,
                      'lng' : weather.longitude
                    }, s2_level).getCornerLatLngs();
                    weather.center = S2.S2Cell.idToLatLng(weather.s2_cell_id);

                    // Avoid timezone issues. This is a UTC timestamp.
                    weather.last_updated = weather.last_updated.replace(' ', 'T') + 'Z';

                    // Convert datetime to UNIX timestamp.
                    weather.last_updated = Date.parse(weather.last_updated) || 0;
                }
                return resolve(results);
            }
        });
    });
}


/* Model. */

const tablename = 'weather';
const Weather = {};

Weather.update_weather_full = () => {

  const query = 'SELECT * FROM ' + tablename;

  prepareWeatherPromise(query).then(function (latest_result) {
      // Add the new ones to the old result and pass to handler.
      //set the new weather as latestWeather
      latestWeather = latest_result;
      //return foundPokestops(pokestops.concat(new_pokestops));
  }).catch(utils.handle_error);
};

Weather.get_latest_alerts = () => {
  var with_alerts = [];

  for (var i = 0; i < latestWeather.length; i++) {
    if (latestWeather[i].warn_weather > 0) {
      with_alerts.push(latestWeather[i]);
    }
  }
  return with_alerts;
};

Weather.get_latest = () => {
  if (Object.keys(latestWeather).length > 0) {
    return latestWeather;
  } else {
    return [];
  }
};

Weather.get_weather = (weather_alerts) => {
  return new Promise((resolve, reject) => {
      if (weather_alerts) {
        return get_latest_alerts();
      } else {
        return latest_result;
      }
  });
};

module.exports = Weather;
