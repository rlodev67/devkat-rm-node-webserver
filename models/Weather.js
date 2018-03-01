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
var latestWeather = [];
//cache the latest neighbouring cells as well as a grid-view.... S2Grid
//store it as json internally with cellID : {Actual info}, convert to array later
var latestNeighbours = {};

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

//we know the center's lat and lng, so let's get the neighbours
//returns array with neighbouring cells' IDs
function getNeighbourIdsOfCellByCoordsOfCenterCell(lat, lng) {
  var neighbours = S2.latLngToNeighborKeys(lat, lng, s2_level);
  for (var i = 0; i < neighbours.length; i++)
  {
    neighbours[i] = S2.keyToId(neighbours[i]);
  }
  return neighbours;
}

//do not operate on latestNeighbours since we do not want a race
function addWeatherCellAndNeighboursToGrid(weatherCellId, newGrid) {
  var latLng = S2.S2Cell.idToLatLng(weatherCellId);
  var ids = getNeighbourIdsOfCellByCoordsOfCenterCell(latLng.lat, latLng.lng);
  ids.push(weatherCellId);

  //for each cell ID check for collision in newGrid
  //if no collision -> add cell's center: {}, s2_cell_id : ID and vertices
  for (var i = 0; i < ids.length; i++) {
    if (typeof newGrid[ids[i]] !== 'undefined') {
      continue; //collision
    }

    //no collision, add the cell with all the relevant information to the newGrid
    var newInfo = {};
    newInfo.center = S2.S2Cell.idToLatLng(ids[i]);
    newInfo.vertices = S2.S2Cell.FromLatLng({
      'lat' : newInfo.center.lat,
      'lng' : newInfo.center.lng
    }, s2_level).getCornerLatLngs();
    newInfo.s2_cell_id = ids[i];
    newGrid[newInfo.s2_cell_id] = newInfo;
  }
}

function updateNeighbours() {
  debug('Updating neighbours');
  if (typeof latestWeather !== 'object' || latestWeather.length == 0) {
    //no weather to be parsed.....
    latestNeighbours = {};
  }

  var newNeighbours = {};
  for (var i = 0; i < latestWeather.length; i++) {
    addWeatherCellAndNeighboursToGrid(latestWeather[i].s2_cell_id, newNeighbours);
  }
  latestNeighbours = newNeighbours;
}

function transformNeighboursToArray() {
  var result = [];
  for (var i in latestNeighbours) {
    result.push(latestNeighbours[i]);
  }

  return result;
}

/* Model. */

const tablename = 'weather';
const Weather = {};


//updates latestWeather... to be called async to simple cache the latest results
Weather.update_weather_and_neighbours_full = () => {

  const query = 'SELECT * FROM ' + tablename;

  prepareWeatherPromise(query).then(function (latest_result) {
      //set the new weather as latestWeather
      latestWeather = latest_result;
      updateNeighbours();
  }).catch(utils.handle_error);
};

//simply return an array with the weather info containing warn_weather > 0
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
  if (typeof latestWeather !== 'undefined' && Object.keys(latestWeather).length > 0) {
    return latestWeather;
  } else {
    return [];
  }
};

Weather.get_weather = (weather_alerts) => {
  if (typeof weather_alerts !== 'boolean') {
    return [];
  }
  return new Promise((resolve, reject) => {
      if (weather_alerts) {
        return resolve(Weather.get_latest_alerts());
      } else {
        return resolve(latestWeather);
      }
  });
};

Weather.get_grid = () => {
  return new Promise((resolve, reject) => {
    return resolve(transformNeighboursToArray());
  });
};

module.exports = Weather;
